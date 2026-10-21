# Integração entre os módulos: decisões e impactos

> Escrito pelo Dev 1 em 21/10/2026. A reunião do Dia 0 (plano §3.1) não deixou registro, então as
> decisões abaixo foram tomadas para fechar o fluxo da Parte 1. **Cada seção diz quem é afetado e o
> que muda para essa pessoa.** Qualquer mudança aqui segue a regra 3.3.8: schema, fixture, tipo TS
> e struct Rust no mesmo PR, com o T-14 passando.

## 1. Redis: nomes

| O quê                 | Nome               | Quem escreve       | Quem lê       | Formato                                   |
| --------------------- | ------------------ | ------------------ | ------------- | ----------------------------------------- |
| Stream de comandos    | `orders`           | Gateway (`XADD`)   | Motor         | campo `payload` = JSON `comando-ordem`    |
| Grupo de consumo      | `engine`           | —                  | Motor         | consumidor `engine-1`                     |
| Resultado de comandos | `ordens.resultado` | Motor (`PUBLISH`)  | Gateway(s)    | JSON `resultado-ordem`, um por comando    |
| Batimento do Motor    | `motor:heartbeat`  | Motor (`SET … EX`) | Gateway, demo | horário em ms; expira em 5 s              |
| Presença              | `presenca`         | Gateway            | Gateway       | ZSET: membro = conexão, score = expira em |

- **Um único canal Pub/Sub.** O Motor publica só o `resultado-ordem`, e o Gateway deriva dele os
  eventos do WebSocket (`ORDEM_ATUALIZADA`, `NEGOCIO`, `PRECO`). O Motor não conhece eventos de tela.
- **Presença** é um ZSET em vez de uma chave por conexão com TTL: o score é o instante em que a
  conexão expira (agora + 10 s), renovado a cada ping. `ZREMRANGEBYSCORE` + `ZCARD` dão o total de
  conectados em todas as réplicas do Gateway, sem `SCAN`. O efeito é o mesmo do TTL de 10 s.

## 2. Comando (`packages/contracts/schemas/comando-ordem.json`)

```json
{ "tipo": "CRIAR", "clientOrderId": "uuid", "investidorId": 1, "ativo": "ABC3",
  "lado": "COMPRA", "quantidade": 100, "preco": "25.50" }
{ "tipo": "CANCELAR", "clientOrderId": "uuid", "investidorId": 1, "ordemId": 42 }
```

- `tipo` diferencia os dois comandos. `investidorId` vem sempre do JWT (RNF-08).
- O schema já recusa preço zero, mais de 2 casas e quantidade fora de `integer`, igual ao DTO do
  Gateway. O Motor valida de novo ao ler (`ComandoOrdem::de_json`).
- Teste manual: `redis-cli XADD orders '*' payload "$(cat packages/contracts/fixtures/validas/comando-criar.json)"`.

## 3. Resultado (`packages/contracts/schemas/resultado-ordem.json`)

```json
{ "clientOrderId": "uuid", "investidorId": 1,
  "ordem": { …OrdemResposta… } | null, "motivoRejeicao": "…",
  "ordensAtualizadas": [ …OrdemResposta… ], "negocios": [ …NEGOCIO.dados… ],
  "mercado": [ …PRECO.dados… ] }
```

- `ordem` é a ordem criada (aceita ou `REJEITADA`) ou a ordem cancelada. É `null` só quando não há
  ordem para mostrar (cancelar ordem inexistente ou de outro investidor), e aí `motivoRejeicao` é
  obrigatório. Ordem de outro investidor nunca é devolvida (RNF-08).
- `ordensAtualizadas` traz **todas** as ordens que mudaram, inclusive as do outro lado de cada
  negócio: é assim que o vendedor fica sabendo que a ordem dele foi executada.
- Comando repetido (mesmo `investidorId` + `clientOrderId`): o Motor publica de novo o resultado
  com o estado atual da ordem e não processa de novo (T-08).

## 4. Autenticação (`common/usuario-atual.ts`)

- O guard do `auth` coloca `req.usuario = { id }` na requisição. O decorator `@UsuarioAtual()`
  lê esse campo e responde **401 `NAO_AUTENTICADO`** se ele não existir, então uma rota com
  `@UsuarioAtual()` nunca roda sem investidor.
- O formato do JWT continua sendo do Dev 4. Só se exige que o guard preencha `req.usuario.id`.

## 5. Gateway: `BarramentoDeOrdens` (`ordens/barramento-de-ordens.ts`)

- O `ordens` não fala com o Redis. Ele chama `BarramentoDeOrdens.enviarEAguardar(comando, timeoutMs)`,
  que o `gateway/bus` implementa. Timeout → `ComandoNaoConfirmado` (504); `XADD` falhou →
  `BarramentoIndisponivel` (503).

## 6. Impactos por pessoa

### Dev 2 (fila e casca do Motor)

- Os schemas `comando-ordem` e `resultado-ordem`, as structs em `apps/engine/src/contract/` e o T-14
  do lado Rust (`apps/engine/tests/contrato.rs`) foram escritos pelo Dev 1 (PR
  `feat/contracts-comando-resultado`). Revise o PR: as decisões das §1 a §3 afetam você mais do que
  ninguém.
- Dinheiro no contrato Rust continua `String`, e a conversão é feita por `contract::decimal()`, para
  que a ida e volta do T-14 seja exata.
- `lib.rs` agora também exporta `contract` (antes só `domain`).

### Dev 3 (núcleo do Motor)

- Nenhuma mudança no `domain/`. A casca usa `Estado::criar`/`Estado::cancelar` como descrito em
  `docs/div3-nucleo-motor.md`.

### Dev 4 (auth + Home Broker)

- O guard precisa preencher `req.usuario = { id }` (§4). O decorator já existe; não recrie.
- `posicoes.preco_medio` tem 4 casas no banco, mas o contrato (`PrecoString`) aceita só 2: arredonde
  no SQL do `carteira` (`round(preco_medio, 2)::text`).
- Na tela, o saldo não chega por evento: quando receber `ORDEM_ATUALIZADA`, busque `GET /carteira`.

### Todos

- **Node 24.9 ou mais novo** (o Jest só carrega o Nest 12, que é ESM, a partir dele). No Node 22,
  os testes do Gateway quebram com "Must use import to load ES Module".
- **Nova variável `LOG_LEVEL`** no `.env` (copie do `.env.example`). Sem ela, o Gateway não sobe.
- **CI** no GitHub Actions roda lint, Prettier, typecheck, testes de TS e Rust e o e2e do Gateway
  em todo PR.
