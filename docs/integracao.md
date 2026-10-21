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

- O `JwtGuard` (global, `auth/jwt.guard.ts`) lê `Authorization: Bearer <jwt>` e, se o token for
  válido, coloca `req.usuario = { id }` na requisição. Ele **não recusa nada sozinho**: quem exige
  login é o decorator `@UsuarioAtual()`, que responde **401 `NAO_AUTENTICADO`** sem `req.usuario`.
  Rota nova que precisa de login: basta usar `@UsuarioAtual()`. Rota pública: não usar.
- JWT HS256 com `{ sub: <id do investidor> }`, assinado com `JWT_SECRET` e validade `JWT_EXPIRACAO`.
- `AuthService.verificar(token)` devolve o investidor ou `undefined`; o WebSocket usa o mesmo método.
- Senha com argon2id (`@node-rs/argon2`, binário pronto, sem build nativo). Login de usuário
  inexistente também roda um `verify`, para não revelar pelo tempo quem está cadastrado.

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
- **A casca do Motor também foi escrita pelo Dev 1** (PR `feat/engine-casca`), porque sem ela não
  havia fluxo de ponta a ponta para a Parte 1. O que existe, e é seu daqui em diante:
  - `config.rs`: `DATABASE_URL`, `REDIS_URL`, `ORDEM_TIMEOUT_MS` (obrigatórias) e
    `ENGINE_CONSUMIDOR` (padrão `engine-1`);
  - `bus/`: consumidor do grupo `engine` (pendentes primeiro, depois `XREADGROUP BLOCK 1000`),
    `PUBLISH` em `ordens.resultado` e batimento a cada 1 s;
  - `store/`: carga do estado (ativos, ordens `ABERTA`/`PARCIAL`, contas dos donos), conta carregada
    sob demanda para investidores novos, e gravação de cada `Resultado` numa transação;
  - `processor.rs`: idempotência, descarte por idade, `Estado::criar`/`cancelar`, troca do estado só
    depois do COMMIT, logs com todos os stages do RF-025;
  - `main.rs`: processa, publica e só então dá `XACK`. Qualquer erro de banco ou Redis encerra o
    processo (fail-fast), e o compose o sobe de novo (`restart: unless-stopped`).
- O id da ordem vem de `nextval` **antes** do domínio, porque o domínio precisa dele para o desempate
  (RF-014). Ordens rejeitadas também são gravadas (`REJEITADA` + motivo), inclusive as vencidas
  (`COMANDO_EXPIRADO`). Cancelamento recusado não grava nada.
- `Rejeicao::ValorInvalido` na criação (total que não cabe em `decimal(15,2)`) vira
  `SALDO_INSUFICIENTE` na compra e `ACOES_INSUFICIENTES` na venda. `EstadoInvalido` para o Motor.
- Testes: `tests/processor.rs` cobre **T-07, T-08, T-09 e T-11** contra o Postgres real, com
  `TEST_DATABASE_URL` (o CI define). **Ainda faltam o T-06** (falha forçada no meio da gravação) e
  as métricas (RF-026).

### Dev 3 (núcleo do Motor)

- Nenhuma mudança no `domain/`. A casca usa `Estado::criar`/`Estado::cancelar` como descrito em
  `docs/div3-nucleo-motor.md`.
- `Estado.ordens` guarda também as ordens já executadas e canceladas desde a subida. Depois de um
  reinício, só as abertas voltam; por isso o processor consulta o banco quando `cancelar` devolve
  `OrdemNaoEncontrada` ou `OrdemNaoCancelavel`, para responder o motivo certo.

### Dev 4 (auth + Home Broker)

- **O `gateway/auth` foi escrito pelo Dev 1** (PR `feat/gateway-auth`), porque o fluxo da Parte 1
  não fechava sem login: cadastro (investidor + posições numa transação), login, argon2id, JWT e o
  guard (§4). Revise o PR; daqui em diante o módulo é seu. **Falta o seed dos agentes**
  (`database/seed`, AP-05), que depende do número e das senhas dos agentes.
- **O `GET /carteira` P1 também foi escrito pelo Dev 1** (PR `feat/gateway-carteira`), porque o
  `SNAPSHOT` do WebSocket usa as mesmas consultas (`carteira.queries.ts`: `buscarCarteira` e
  `listarOrdensAbertas`). Faltam a parte P2 (patrimônio, P/L) e o histórico (RF-008).
- `nomeUsuario` aceita só letras, números, `.`, `-` e `_` (3 a 50). O schema `api-rest` só limita o
  tamanho; se quiser a mesma regra no contrato, acrescente o `pattern` lá.
- `posicoes.preco_medio` tem 4 casas no banco, mas o contrato (`PrecoString`) aceita só 2: o
  `carteira` já arredonda no SQL (`round(preco_medio, 2)::text`).
- Na tela, o saldo não chega por evento: quando receber `ORDEM_ATUALIZADA`, busque `GET /carteira`.
- **Decisão pendente (grupo):** as posições iniciais do cadastro ficam com `preco_medio = 0`, porque
  o `gateway_app` só pode inserir `investidor_id`, `ativo_id` e `quantidade_disponivel`. A primeira
  compra puxa a média para baixo (ex.: 1.000 ações a 0 + 100 a R$ 102 = média R$ 9,27). Se o grupo
  quiser a média inicial igual ao `preco_inicial` do ativo, é preciso uma migração nova que libere
  essa coluna no `GRANT` (ou um `DEFAULT` calculado).

### Todos

- **Node 24.9 ou mais novo** (o Jest só carrega o Nest 12, que é ESM, a partir dele). No Node 22,
  os testes do Gateway quebram com "Must use import to load ES Module".
- **Nova variável `LOG_LEVEL`** no `.env` (copie do `.env.example`). Sem ela, o Gateway não sobe.
- **CI** no GitHub Actions roda lint, Prettier, typecheck, testes de TS e Rust, a integração do
  Motor e o e2e do Gateway em todo PR.
- O **Motor agora fica de pé** no compose (`restart: unless-stopped`) e precisa de `REDIS_URL` e
  `ORDEM_TIMEOUT_MS`, que o compose já repassa.
