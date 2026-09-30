# Software Architecture and Patterns — Simulador de Bolsa de Valores Multiplayer

> Baseado em: `requirements.md` (v1.0), `system_design.md` (rascunho, 30/09/2026), `simulador-bolsa.dbml` + `simulador-bolsa-modelo-explicado.md`
> Stack (definida no system design §2): **TypeScript** — Next.js (Home Broker), NestJS (Gateway), Node.js (Agentes) · **Rust** — tokio + sqlx + redis + serde (Motor) · PostgreSQL 16 · Redis 7 · Prometheus · k6
> Status: Rascunho

## 0. Resumo em linguagem simples

O projeto fica num **único repositório**, com uma pasta para cada peça do system design: Home Broker, Gateway, Motor e Agentes. Há também uma pasta de **contratos**, que descreve o formato de toda mensagem trocada entre as peças. Cada peça segue o jeito mais simples de organizar código na sua tecnologia. A exceção é o **Motor**: a regra de negócio dele (casar ordens, reservar saldo, calcular preço médio) fica isolada numa parte que não acessa banco nem rede. Assim ela pode ser testada à exaustão em milissegundos, e é nela que um erro custaria dinheiro. Três barreiras seguidas protegem o dinheiro: o Gateway recusa pedidos malformados, o Motor recusa pedidos sem saldo e o banco recusa qualquer valor negativo. Os testes obrigatórios (T-01 a T-16) provam exatamente as regras que o professor vai cobrar na demonstração.

## 1. Padrão Arquitetural do Código

**Escolha:** **monorepo com um app por componente do system design**. Em cada app, a arquitetura é a mais simples que o domínio daquele app permite:

| App | Padrão | Justificativa |
|---|---|---|
| `gateway` (NestJS) | **Camadas por módulo** (Controller → Service → consultas SQL), um módulo Nest por área | É borda: autentica, valida, repassa e lê. Não tem regra de mercado (RNF-10), então camadas simples bastam. |
| `engine` (Rust) | **Núcleo puro + casca de I/O** (*functional core, imperative shell*): `domain/` sem async, sem banco e sem Redis; `processor.rs` orquestra transação, commit, publicação e ack | É o único escritor de dinheiro (RNF-01, RF-016). As regras de RF-013 a RF-017 precisam de centenas de casos de teste (T-01 a T-05), o que só fica viável se a lógica rodar sem banco. É uma versão enxuta de Hexagonal, **sem interfaces/traits de porta**: a casca chama o núcleo direto. |
| `web` (Next.js) | **Componentes + estado derivado de eventos** (reducer puro) | O cliente só exibe e envia comandos (RNF-10). O único ponto não trivial é aplicar snapshot + eventos incrementais (RF-018, RNF-05), que fica num reducer testável. |
| `agents` (Node/TS) | **Strategy** para os perfis, sobre um cliente HTTP/WS comum | RF-020 exige ≥ 2 perfis com regras distintas, e RF-021 (*Could*) adiciona viés por evento. |

**Descartado:** Clean Architecture completa no Gateway (ele não tem domínio para proteger); Repository com interfaces em qualquer app (cada app tem uma única fonte de dados e nenhuma troca prevista; no Motor, uma troca de banco significaria CockroachDB, que fala o mesmo protocolo — system design §3); CQRS/Event Sourcing (fora do escopo, SRS §1.2).

## 2. Estrutura de Diretórios e Módulos

```
simulador-bolsa/
├── docker-compose.yml          # sobe tudo com um comando (RNF-09)
├── .env.example                # todas as variáveis, com valores de exemplo; o .env real não é versionado
├── README.md                   # como rodar, testar e demonstrar a falha (CA-06)
├── pnpm-workspace.yaml         # workspace dos apps TypeScript
│
├── packages/
│   └── contracts/              # FONTE ÚNICA dos formatos de mensagem (system design §2)
│       ├── schemas/            # JSON Schema: comando-ordem, resultado-ordem, evento-mercado, api-rest
│       ├── fixtures/           # exemplos válidos/inválidos lidos pelos testes de TS e de Rust (T-14)
│       └── src/                # tipos TS gerados a partir dos schemas + dinheiro.ts (conversão string ⇄ centavos)
│
├── apps/
│   ├── gateway/                # NestJS — borda REST + WebSocket
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── common/         # AppError + códigos de erro, filtro global de exceções, @UsuarioAtual
│   │   │   ├── config/         # leitura e validação das variáveis de ambiente (falha ao subir se faltar)
│   │   │   ├── database/       # pool pg, helper de transação, seed dos investidores-agente
│   │   │   ├── bus/            # Redis: XADD no stream, assinatura Pub/Sub, espera do resultado por clientOrderId
│   │   │   ├── observability/  # logger pino (com redact), métricas prom-client, GET /metrics
│   │   │   ├── auth/           # cadastro, login, hash argon2, JWT, JwtGuard (REST e WS)
│   │   │   ├── ordens/         # POST/DELETE/GET /ordens: valida formato, envia ao Motor, aguarda (timeout 3 s)
│   │   │   ├── carteira/       # GET /carteira e /historico: leitura direta do Postgres
│   │   │   ├── mercado/        # snapshot em memória (preços, volume, top-5 do livro); GET /mercado
│   │   │   └── realtime/       # WebSocket: auth na abertura, ping 5 s, presença no Redis, envio de eventos
│   │   └── test/               # e2e com supertest + ws contra Postgres/Redis reais
│   │
│   ├── engine/                 # Rust — Motor de Negociação (escritor único)
│   │   ├── Cargo.toml
│   │   ├── src/
│   │   │   ├── main.rs         # bootstrap: config, conexões, migrações, recuperação do livro, laço principal
│   │   │   ├── config.rs
│   │   │   ├── domain/         # NÚCLEO PURO — proibido async, sqlx, redis, relógio e aleatoriedade
│   │   │   │   ├── dinheiro.rs     # Preco, Dinheiro (Decimal, 2 casas), Quantidade; construtores validam > 0
│   │   │   │   ├── ordem.rs        # Ordem, Lado, StatusOrdem
│   │   │   │   ├── livro.rs        # LivroDeOfertas: por lado, BTreeMap<Preco, VecDeque<Ordem>>
│   │   │   │   ├── casamento.rs    # casar(&livro, &ordem) → execuções (RF-014, RF-015)
│   │   │   │   ├── conta.rs        # checagem de saldo/ações disponíveis, reservas, preço médio (RF-009/010/005)
│   │   │   │   └── resultado.rs    # Resultado = execuções + deltas de saldo/posição + eventos; Rejeicao
│   │   │   ├── processor.rs    # casca: comando → BEGIN → domínio → COMMIT → aplica no livro → PUBLISH → XACK
│   │   │   ├── store/          # sqlx: carregar ordens abertas, gravar Resultado, checar idempotência
│   │   │   ├── bus/            # consumidor do stream "orders", publicador, heartbeat
│   │   │   ├── contract/       # structs serde que espelham packages/contracts/schemas
│   │   │   └── telemetry/      # tracing JSON, métricas Prometheus, HTTP /metrics
│   │   └── tests/              # integração com Postgres real + fixtures de contrato
│   │
│   ├── web/                    # Next.js — Home Broker (só cliente)
│   │   └── src/
│   │       ├── app/            # rotas: login/, cadastro/, painel/ — todas "use client"
│   │       ├── components/     # por área: carteira/, mercado/, livro/, ordem/, historico/, ui/
│   │       ├── state/          # reducer puro: snapshot + eventos → estado da tela
│   │       ├── api/            # cliente REST (fetch com token) e cliente WS com reconexão a cada ≤ 5 s
│   │       └── lib/            # formatação de dinheiro/percentual, guarda do token
│   │
│   └── agents/                 # Node/TS — NPCs, clientes comuns da API
│       └── src/
│           ├── main.ts         # lê config (quantidade e perfis) e inicia os agentes
│           ├── config.ts
│           ├── client/         # REST + WS para o Gateway (a mesma API dos humanos)
│           ├── estrategias/    # tipos.ts (interface Estrategia), conservadora.ts, agressiva.ts
│           ├── agente.ts       # laço: observa mercado → estratégia decide → envia ordens
│           └── eventos.ts      # (Could, RF-021) viés por evento econômico
│
├── db/
│   ├── init/                   # roda uma vez na criação do Postgres: cria os papéis gateway_app e engine_app
│   └── migrations/             # SQL numerado (0001_schema.sql, 0002_ativos.sql, 0003_grants.sql…)
│
├── load-tests/                 # scripts k6: carga 5/20/50/100 (RNF-04), concorrência (T-15), cenário §6 (T-16)
├── infra/
│   └── prometheus/             # prometheus.yml (scrape de gateway e engine)
└── docs/                       # documentos da esteira, diagramas, relatório de carga
```

**Regras da estrutura:**
- Cada app tem o próprio `Dockerfile` na sua pasta. O `docker-compose.yml` na raiz é o único ponto de subida.
- As **migrações são SQL puro** em `db/migrations/`, a fonte única do schema (DBML → SQL). Quem as aplica é o Motor ao subir (`sqlx::migrate!`), porque ele é o dono das escritas. O Gateway não tem migrações nem ORM: usa `pg` com SQL escrito à mão, e os tipos das linhas ficam definidos em cada arquivo `*.queries.ts`.
- **Papéis de banco separados** (`0003_grants.sql`): `engine_app` pode escrever em tudo. `gateway_app` tem `SELECT` em tudo e `INSERT` só em `investidores` e `posicoes` (cadastro), sem nenhum `UPDATE`/`DELETE`. Isso torna a regra "só o Motor altera dinheiro" (system design §2) verificável pelo próprio banco. O cadastro cria saldo, mas não o altera: nenhuma ordem pode existir antes de o investidor existir.
- Dentro de cada módulo do Gateway: `x.module.ts`, `x.controller.ts`, `x.service.ts`, `x.queries.ts` (SQL), `dto/` e testes `*.spec.ts` ao lado do arquivo testado.
- Os agentes são criados pelo **seed do Gateway** (`database/seed`), porque precisam do mesmo hash de senha. Os ativos entram por migração SQL (`0002_ativos.sql`, Apêndice B do SRS).

### Módulos (nomes usados pela Etapa 5)

| Módulo | Responsabilidade | Requisitos / tabelas |
|---|---|---|
| `contracts` | Schemas JSON, fixtures, tipos TS, helper de dinheiro | system design §2; T-14 |
| `db` | Schema, CHECKs, seed de ativos, papéis e permissões | RF-022, RNF-01; todas as tabelas |
| `gateway/auth` | Cadastro (cria investidor + posições iniciais numa transação), login, JWT, guard | RF-001, RF-002, RNF-06; `investidores`, `posicoes` (INSERT) |
| `gateway/ordens` | Validação de formato, envio ao stream, espera do resultado, consulta de status | RF-009 a RF-012, RNF-07, RNF-08; `ordens` (leitura) |
| `gateway/carteira` | Saldo, patrimônio, P/L, posições, histórico de ordens e negócios (contas feitas no SQL) | RF-005, RF-008; `investidores`, `posicoes`, `ordens`, `negocios` |
| `gateway/mercado` | Snapshot de mercado em memória, alimentado por eventos | RF-006, RF-007; `ativos` (carga inicial) |
| `gateway/realtime` | WebSocket, presença, reconexão com snapshot, envio de eventos | RF-003, RF-004, RF-018, RF-023, RNF-02, RNF-11 |
| `gateway/bus` | Integração com Redis Stream/Pub/Sub e correlação de respostas | RF-014 (sequência), RF-024 |
| `gateway/observability` | Logs estruturados, métricas | RF-025, RF-026 |
| `engine/domain` | Livro, casamento preço + tempo, reservas, preço médio, cancelamento | RF-009, RF-010, RF-012 a RF-017, RNF-01 |
| `engine/processor` + `engine/store` | Transação por comando, idempotência, recuperação do livro, descarte de comandos vencidos | RF-016, RF-022, RF-024; `ordens`, `negocios`, `investidores`, `posicoes`, `ativos` |
| `engine/bus` + `engine/telemetry` | Consumo do stream, publicação, heartbeat, logs e métricas | RF-018, RF-025, RF-026 |
| `web` | Telas de login/cadastro e painel | RF-005 a RF-008, RNF-11 |
| `agents` | ≥ 5 NPCs com perfis conservador/agressivo | RF-019, RF-020, RF-021 |
| `load-tests` | k6 de carga, concorrência e cenário do PDF | RNF-04, CA-02, CA-03, CA-04 |

## 3. Padrões de Código e Design Patterns

### 3.1 Design patterns adotados (só estes)

| Padrão | Problema de domínio que resolve | Onde se aplica |
|---|---|---|
| **Núcleo puro / casca de I/O** | A regra do dinheiro precisa ser provada em muitos cenários (RF-014 a RF-016, CA-03) sem subir banco. | `engine/domain` (puro) × `engine/processor` (I/O) |
| **Escritor único + aplicação após commit** | O livro em memória não pode divergir do banco (system design §5.1). | `processor.rs`: o domínio **calcula** o `Resultado` sobre `&LivroDeOfertas` (imutável); o livro só é alterado com `livro.aplicar(&resultado)` **depois** do COMMIT. Se o commit falhar, o Motor encerra e reconstrói o livro do Postgres ao reiniciar. |
| **Comando idempotente** | Reenvio após timeout não pode gerar ordem dupla (system design §4). | `engine/store`: antes de processar, busca `(investidor_id, client_order_id)`. Se já existir, republica o resultado anterior e dá XACK. |
| **Strategy** | Perfis de agente com regras diferentes que tendem a crescer (RF-020, RF-021). | `agents/estrategias`: `interface Estrategia { decidir(mercado, carteira): IntencaoDeOrdem[] }`, função pura. |
| **Snapshot + eventos (reducer)** | O cliente precisa de estado correto após reconexão e de atualização incremental (RF-004, RF-018). | `web/state`: `reducer(estado, mensagem)`, em que `SNAPSHOT` substitui tudo e os demais eventos alteram em cima dele. |
| **Correlação requisição → resposta assíncrona** | O `POST /ordens` responde só depois do Motor, mas a resposta chega por Pub/Sub. | `gateway/bus`: um `Map<clientOrderId, {resolve, timer}>`, resolvido pelo evento de resultado ou rejeitado após 3 s (SD-04). |

Nenhum outro pattern (Factory, Repository com interface, Mediator, etc.) é necessário. O resto é Controller → Service → SQL no Gateway e componentes React no front.

### 3.2 Convenções de nomes

| Onde | Regra | Exemplo |
|---|---|---|
| **Termos do negócio** | Em **português**, os mesmos do SRS e do banco, sem tradução em nenhuma camada | `Ordem`, `LivroDeOfertas`, `casar()`, `saldoReservado`, `gateway/ordens` |
| **Termos técnicos** | Em inglês, como a stack espera | `controller`, `service`, `module`, `processor`, `store`, `bus`, `config` |
| Banco | `snake_case`, conforme DBML | `saldo_disponivel`, `client_order_id` |
| JSON (API, Redis, WS) | `camelCase`; enums em `MAIUSCULO_COM_UNDERSCORE` | `{ "clientOrderId": "…", "status": "PARCIAL" }` |
| TypeScript | arquivos `kebab-case.ts`; classes/tipos `PascalCase`; funções/variáveis `camelCase` | `ordens.service.ts`, `OrdensService` |
| Rust | padrão da linguagem (`snake_case` para funções/módulos, `PascalCase` para tipos); `#[serde(rename_all = "camelCase")]` nas structs de contrato | `fn casar(...)`, `struct ComandoOrdem` |
| Métricas | prefixo `bolsa_`, unidade no nome | `bolsa_ordens_processadas_total`, `bolsa_ordem_latencia_segundos` |

### 3.3 Regras de código obrigatórias

1. **Dinheiro nunca é ponto flutuante.** Rust: `rust_decimal::Decimal` (mapeado para `NUMERIC`). JSON: string decimal (`"102.00"`). TypeScript: string. Quando precisar fazer conta (agentes), use o helper `packages/contracts/src/dinheiro.ts` (centavos inteiros). No Gateway, as contas de patrimônio e P/L ficam **no SQL** (RF-005).
2. **Desempate por tempo = `ordens.id`**, nunca `criado_em` (modelo de dados, decisão de `ordens`).
3. **`userId` vem só do JWT.** Se o corpo da requisição trouxer `investidorId`/`userId`, o DTO rejeita (`forbidNonWhitelisted`) (RNF-08).
4. **O frontend não calcula regra de mercado**, só formata o que o Gateway manda (RNF-10). É proibido criar `app/api/` ou Server Actions no Next. Recomendado: `output: 'export'`.
5. **Agentes não têm acesso ao banco nem ao Redis.** O contêiner deles recebe só a URL do Gateway (RF-019: "mesmas regras dos humanos").
6. **Rust:** `unwrap()`/`expect()` proibidos fora de `main.rs` e de testes (`clippy::unwrap_used`). `domain/` não pode importar `sqlx`, `redis`, `tokio` nem `chrono::Utc::now`: o horário, quando necessário, entra como parâmetro.
7. **Comentários:** toda função pública de `engine/domain` e todo método de service tem comentário de documentação. Quando o código implementa uma regra de requisito, cite o ID: `// RF-015: o negócio sai pelo preço da ordem que já estava no livro`. Isso atende RNF-12 e dá rastreabilidade para a banca.
8. **Mudança de contrato é atômica:** schema, fixture, tipo TS e struct Rust mudam **no mesmo PR**, e T-14 precisa passar.
9. **Configuração só por variável de ambiente**, validada ao subir (NestJS `ConfigModule` com schema; Rust `config.rs`). Faltou variável → o processo não sobe.

### 3.4 Ferramentas de padronização

| Stack | Ferramenta | Regra |
|---|---|---|
| TypeScript | `tsconfig` com `strict: true`; ESLint (`typescript-eslint` recomendado + `no-floating-promises`); Prettier | CI local: `pnpm lint && pnpm test` |
| Rust | `rustfmt`; `clippy -D warnings` + `unwrap_used` | `cargo fmt --check && cargo clippy && cargo test` |
| Git | Um branch por tarefa, PR revisado por outro integrante, commits no formato `tipo(escopo): descrição` em português (`feat(engine): casamento com execução parcial`) | Cada commit feito por quem escreveu o código (RNF-12, §16 do PDF) |

## 4. Tratamento de Erros, Validação e Logs

### 4.1 Validação: três barreiras, cada uma com um papel

| Barreira | Onde | O que valida | Requisito |
|---|---|---|---|
| 1. Formato | Gateway — DTOs com `class-validator` + `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` | tipos, `quantidade` inteira > 0, `preco` string decimal > 0 com até 2 casas, `ativo` no padrão do código, `clientOrderId` UUID | RNF-07 |
| 2. Regra de negócio | Motor — `domain/` | ativo existe, saldo/ações **disponíveis** (descontadas reservas), ordem é do solicitante, ordem é cancelável | RF-009, RF-010, RF-012, RNF-08 |
| 3. Invariante | Postgres — `CHECK`s do modelo de dados | nada negativo, quantidades coerentes | RNF-01 |

A validação no frontend existe só para conforto do usuário e nunca substitui a barreira 1. Violar a barreira 3 é **bug**, não rejeição: o Motor registra `error`, faz rollback e encerra para reconstruir o estado (fail-fast).

### 4.2 Erros

- **Rejeição de regra não é erro.** No Motor, `domain` retorna `Result<Resultado, Rejeicao>`. A `Rejeicao` vira uma ordem gravada com `status = REJEITADA` e `motivo_rejeicao` (RF-008, RF-011). Falhas de infraestrutura usam tipos `thiserror` em `store/` e `bus/`; `anyhow` só em `main.rs`.
- **Códigos de rejeição** (enum no contrato): `SALDO_INSUFICIENTE`, `ACOES_INSUFICIENTES`, `ATIVO_INEXISTENTE`, `ORDEM_NAO_ENCONTRADA`, `ORDEM_DE_OUTRO_INVESTIDOR`, `ORDEM_NAO_CANCELAVEL`, `COMANDO_EXPIRADO`.
- **No Gateway**, os services lançam `AppError(codigo, httpStatus, mensagem)`, e um único filtro global o traduz para:

```json
{ "erro": { "codigo": "VALIDACAO", "mensagem": "quantidade deve ser inteira e maior que zero", "campos": ["quantidade"] }, "requestId": "…" }
```

| Situação | HTTP | `codigo` |
|---|---|---|
| Formato inválido | 400 | `VALIDACAO` |
| Sem token / token inválido / login errado | 401 | `NAO_AUTENTICADO` / `CREDENCIAIS_INVALIDAS` |
| Ordem de outro investidor (consulta ou cancelamento) | 403 | `ORDEM_DE_OUTRO_INVESTIDOR` |
| Usuário já existe | 409 | `USUARIO_JA_EXISTE` |
| Ordem processada pelo Motor (aceita **ou rejeitada**) | 201 | corpo = a ordem, com `status` e `motivoRejeicao` |
| Motor não respondeu em 3 s | 504 | `NAO_CONFIRMADA` ("reenvie": o `clientOrderId` garante que o reenvio não duplica) |
| Redis/Motor fora | 503 | `MERCADO_INDISPONIVEL` |
| Qualquer outra exceção | 500 | `ERRO_INTERNO` (detalhe só no log, nunca na resposta) |

- **Erros no WebSocket:** mensagem `{ "tipo": "ERRO", "codigo": … }`. Uma queda de conexão nunca derruba a tela: o cliente mostra "desconectado" e tenta de novo a cada ≤ 5 s (RNF-11).
- **Comandos vencidos (RF-024):** o Motor descarta, com `COMANDO_EXPIRADO`, todo comando cujo ID no stream (que carrega o horário de chegada em ms) seja mais antigo que o timeout de confirmação (3 s). É isso que implementa "ordens não confirmadas antes da queda são descartadas": sem essa regra, uma ordem que o cliente já deu por perdida seria executada quando o Motor voltasse.

### 4.3 Logs

- **Formato:** JSON, uma linha por evento, em stdout (pino no Gateway e `tracing` JSON no Motor). Campos padronizados: `ts`, `level`, `service`, `stage`, `orderId`, `clientOrderId`, `userId`, `streamId`, `requestId`, `durMs`.
- **`stage`** usa exatamente os nomes do RF-025: `ORDER_RECEIVED`, `ORDER_VALIDATED`, `ORDER_BOOK_INSERTED`, `MATCH_FOUND`, `TRADE_EXECUTED`, `PORTFOLIO_UPDATED`, `CLIENTS_NOTIFIED`, `ORDER_REJECTED`. As constantes ficam em `packages/contracts` e são espelhadas no Rust, para evitar variação de grafia.
- **Níveis:** `error` para falha de infraestrutura ou violação de invariante; `warn` para timeout, descarte, reconexão ou Redis indisponível; `info` para estágios do RF-025, conexão e desconexão, subida e recuperação do Motor (com a quantidade de ordens recarregadas); `debug` desligado na demo e nos testes de carga.
- **Nunca logar:** senha, `senha_hash`, JWT, header `Authorization`, corpo das rotas `/auth/*`. Configure `redact` do pino para `req.headers.authorization`, `*.senha` e `*.token`. Identifique o investidor por `userId`, não por nome de usuário.
- **Métricas (RF-026):** `bolsa_ordens_processadas_total{resultado}`, `bolsa_ordem_latencia_segundos` (histograma, para p95), `bolsa_clientes_conectados`, `bolsa_erros_total{tipo}`, `bolsa_fila_pendente`.

## 5. Regras de Testes

| Tipo | Obrigatório para | Ferramenta | Cobertura mínima esperada |
|---|---|---|---|
| Unitário — núcleo do Motor | `engine/domain` inteiro | `cargo test` + `proptest` | **≥ 90% de linhas** (código puro, é barato e é onde está o dinheiro) |
| Unitário — TS | `agents/estrategias`, `web/state` (reducer), `packages/contracts/dinheiro`, services do Gateway com lógica | Vitest (Jest no Gateway, padrão Nest) | ~60% nessas pastas; controllers e componentes visuais não precisam |
| Integração — Motor | `store` + `processor` contra **Postgres real** (contêiner) | `cargo test` + `sqlx::test` | caminho feliz + falha em cada operação de escrita |
| Integração — Gateway (e2e) | auth, ordens, carteira, WebSocket contra Postgres/Redis reais e Motor real (compose de teste) | supertest + `ws` | caminho feliz + 1 falha por rota |
| Contrato | todo schema de `packages/contracts` | fixtures lidas por Vitest (ajv) e por `cargo test` (serde) | 100% dos schemas |
| Sistema | concorrência, cenário do PDF, carga | k6 + script SQL de conferência | — |

### Provas obrigatórias (antes da entrega final)

| ID | O que prova | Nível | Requisito protegido |
|---|---|---|---|
| T-01 | Exemplo do §3 do PDF: melhor venda R$ 102 e melhor compra R$ 101. D compra 150 @ 102 → negócio de 100 @ 102 com A, e 50 de D ficam abertas no livro | unit engine | RF-013, RF-014 |
| T-02 | Compra com limite 105 contra venda a 102 executa a 102, e a diferença reservada volta ao saldo disponível | unit engine | RF-015, RF-009 |
| T-03 | Duas vendas no mesmo preço: casa primeiro a de menor `id`, mesmo com `criado_em` igual | unit engine | RF-014 |
| T-04 | Compra acima do saldo disponível e venda acima das ações disponíveis (considerando reservas de ordens abertas) são rejeitadas com o código certo | unit engine | RF-009, RF-010, RNF-01 |
| T-05 | **Propriedade:** para qualquer sequência aleatória de ordens e cancelamentos, a soma de dinheiro (disponível + reservado) e a soma de ações por ativo ficam constantes, e nada fica negativo | unit engine (`proptest`) | RNF-01, RF-016, CA-03 |
| T-06 | Falha forçada no meio da gravação de um negócio → nada gravado no banco **e** livro em memória inalterado | integração engine | RF-016 |
| T-07 | Após reiniciar o Motor, o livro reconstruído do Postgres é idêntico ao de antes da queda (mesma ordem de prioridade) | integração engine | RF-024, RF-022 |
| T-08 | O mesmo comando (`clientOrderId`) enviado 2× gera uma única ordem e o mesmo resultado | integração engine | system design §4 |
| T-09 | Comando mais antigo que o timeout é descartado com `COMANDO_EXPIRADO` e não altera nenhum saldo | integração engine | RF-024 |
| T-10 | Investidor B não consegue ver nem cancelar ordem de A (403), e um `userId` enviado no corpo é recusado | e2e gateway | RNF-08, RF-012 |
| T-11 | Cancelar uma ordem parcial devolve ao disponível exatamente a reserva restante (dinheiro ou ações) | unit + integração engine | RF-012 |
| T-12 | A senha é gravada como hash argon2; login errado → 401; REST e WebSocket sem token → recusados | e2e gateway | RNF-06, RF-002 |
| T-13 | Matriz de entradas inválidas (quantidade 0, -1, 1.5, "abc"; preço 0, "1.234", negativo; ativo inexistente; campos extras) → 400, e nada chega ao stream | e2e gateway | RNF-07 |
| T-14 | Toda fixture válida é aceita e toda inválida é recusada **igualmente** pelo TS (ajv) e pelo Rust (serde + validação), com ida e volta sem perda | contrato | system design §2 |
| T-15 | N clientes enviam ordens simultâneas por 1 min; ao final, a query de conferência mostra totais de dinheiro e ações iguais aos do início (mesmo conjunto de investidores) e nenhum negativo | sistema (k6 + SQL) | CA-03, RNF-01 |
| T-16 | Cenário do §6 do PDF (João, Maria e Pedro ao mesmo tempo) executa os 8 passos; filtrar o log por `orderId` mostra todos os estágios do RF-025 | sistema | CA-02, RF-025 |

**Fora do teste automatizado nesta entrega:**
- **Aparência e usabilidade do Home Broker:** checklist manual antes de cada entrega (a nota vem da demonstração, e automatizar testes de tela custa mais do que rende em 2 meses).
- **Demo de falha (CA-05):** roteiro manual ensaiado em `docs/`. As partes críticas já são cobertas por T-07 e T-09.
- **Comportamento dos agentes (RF-020):** as estratégias têm teste unitário, mas "comportamentos distintos" são mostrados pelos logs, não verificados por asserção.
- **Carga (CA-04):** é medição, não passa/falha. Os resultados vão para o relatório.

## 6. Armadilhas Conhecidas

- **"Só um UPDATE rápido" no Gateway**, que quebraria o escritor único. → O papel `gateway_app` não tem `UPDATE` (§2): o banco recusa. Todo o dinheiro passa por `engine/processor`.
- **Livro em memória alterado antes do commit**: se a transação falhar, o livro passa a mostrar uma ordem que não existe no banco. → Domínio calcula sobre `&LivroDeOfertas` e o livro só é alterado após o COMMIT (§3.1); T-06 prova isso.
- **Dinheiro em `number`/`f64`**: `0.1 + 0.2` em JavaScript quebra a conservação de dinheiro do CA-03. → Regra 3.3.1: dinheiro trafega como string, contas ficam no SQL, no `Decimal` do Rust ou em centavos inteiros nos agentes.
- **Contrato TS ≠ Rust**: um campo renomeado de um lado só faz o Motor ignorar ordens em silêncio. → Fonte única em `packages/contracts`, mudança no mesmo PR, e T-14.
- **Ordem "fantasma" após a queda do Motor**: um comando parado no stream seria executado depois que o cliente já foi avisado para reenviar. → Descarte por idade (§4.2) + idempotência; T-08 e T-09.

## 7. Suposições desta etapa

| ID | Suposição | Quem confirma |
|---|---|---|
| AP-01 | O grupo não tem convenção de código prévia; valem as regras da §3. | Grupo |
| AP-02 | Nomes de negócio em português e técnicos em inglês (§3.2). Se o grupo preferir tudo em inglês, basta criar um glossário; o banco continua como no DBML. | Grupo |
| AP-03 | pnpm workspaces para os apps TS; o Motor fica fora do workspace (Cargo). | Grupo |
| AP-04 | Ferramentas de geração de tipos (JSON Schema → TS), lint e teste contam como dependências permitidas, mesma dúvida de SD-02. Se o professor vetar a geração, os tipos TS são escritos à mão e T-14 continua garantindo a equivalência. | Professor |
| AP-05 | Os agentes são criados por seed no Gateway com senhas vindas de variável de ambiente. | Grupo |

## 8. O que este documento não decide

- **Ordem de implementação e o que entra na Parte 1 × Parte 2** → `plano-de-implementacao.md` (Etapa 5).
- **CI/CD e pipeline de deploy** → fora de escopo (a entrega roda local com `docker compose up`).
- **Topologia, protocolos e tecnologias** → `system_design.md` (Etapa 2).
- **Tabelas, colunas e CHECKs** → `simulador-bolsa.dbml` (Etapa 3); aqui só se define *quem* escreve em cada tabela.
- **Integridade acadêmica:** as assinaturas e trechos deste documento são ilustrativos. O código é escrito pelo grupo (§2.4 do SRS).
