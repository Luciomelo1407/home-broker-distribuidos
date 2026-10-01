# Simulador de Bolsa de Valores Multiplayer

Trabalho de Sistemas Distribuídos (UFS). Os documentos de requisitos, arquitetura, modelo de dados e o
plano de implementação estão em [`docs/`](docs/).

## Próximos passos — 02/10/2026

> Seção temporária. Sai do README quando o Dia 0 de todos estiver fechado (critério no fim desta seção).
> O plano completo está em [`docs/plano-de-implementacao.md`](docs/plano-de-implementacao.md): papéis na §2,
> Dia 0 na §3 e tarefas por semana na §4.

**Onde estamos:** o Dev 1 já entregou o esqueleto do monorepo, o compose e o banco com as migrações (na `main`),
além da base do Gateway (`config`, `common` e `database`), que está no PR `feat/gateway-base`. Ainda faltam os
contratos v0 (`packages/contracts`, Dev 2 e Dev 4) e o domínio do Motor (Dev 3). **Amanhã é o Dia 0 de quem
ainda não começou.**

### Todos, antes de programar

1. **Escolher o papel** (Dev 2, 3 ou 4) no grupo. O Dev 1 já está definido.
2. **Preparar a máquina:** instale os [pré-requisitos](#pré-requisitos) e rode:

   ```bash
   git clone git@github.com:Luciomelo1407/home-broker-distribuidos.git simulador-bolsa
   cd simulador-bolsa
   cp .env.example .env
   docker compose up --build   # espere "engine-1 | migrações aplicadas"
   pnpm install && pnpm -r test
   cargo test
   ```

   Se algo falhar aqui, avise o Dev 1 antes de seguir.

3. **Reunião de 1h com os quatro**, com a pauta fechada da §3.1 do plano. Só se decide o que faria duas pessoas
   escreverem coisas incompatíveis:
   - campos dos comandos `CRIAR` e `CANCELAR` no stream `orders`;
   - formato do resultado da ordem;
   - tipos de evento de mercado;
   - nomes no Redis (stream, grupo, canais, chaves de presença e de heartbeat);
   - rotas REST da P1;
   - assinatura do domínio (o que a casca do Motor entrega ao núcleo e o que recebe de volta).

   Anote as decisões no PR de contratos. Elas valem para todo mundo.

4. **Como trabalhar no repositório** (arquitetura §3.4):
   - um branch por tarefa (`feat/engine-livro`, `feat/contracts-comando`…) e nada direto na `main`;
   - commits no formato `tipo(escopo): descrição`, em português, feitos por quem escreveu o código. A avaliação
     olha a autoria;
   - PR revisado pelo par: **Dev 2 ⇄ Dev 3** (Rust) e **Dev 1 ⇄ Dev 4** (TS). PR em `packages/contracts` precisa
     de alguém da outra linguagem;
   - antes de abrir o PR, rode `pnpm lint && pnpm format:check && pnpm -r test` e/ou
     `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test`.

### Dev 1 — Plataforma + Gateway

1. Ajustar e integrar o PR `feat/gateway-base` depois da revisão do Dev 4.
2. **CI mínimo** no GitHub Actions: lint, Prettier e testes de TS, mais `cargo fmt`, `clippy` e `cargo test`.
3. `gateway/observability`: logger pino com `redact` (`authorization`, `*.senha`, `*.token`), usando o
   `x-request-id` que o `common` já gera.
4. Revisar os PRs de contratos e atualizar este README quando eles entrarem.
5. Em seguida, `gateway/ordens` (`POST /ordens`, DTOs e espera de 3 s) até o **T-13**. Enquanto o `gateway/bus`
   do Dev 2 não existir, o resultado é simulado com `redis-cli PUBLISH` usando uma fixture.

### Dev 2 — Fila e casca do Motor (Rust + `gateway/bus` em TS)

1. **Contratos do lado do Motor:** JSON Schemas `comando-ordem` e `resultado-ordem` em
   `packages/contracts/schemas/`, com exemplos em `fixtures/validas/` e `fixtures/invalidas/`.
2. **Structs serde** que espelham esses schemas em `apps/engine/src/contract/`, com
   `#[serde(rename_all = "camelCase")]`. Dinheiro é string decimal no JSON e `rust_decimal::Decimal` no Rust.
3. **Lado Rust do T-14:** um `cargo test` que lê as fixtures e confere que as válidas são aceitas e as inválidas
   recusadas.
4. Depois: a casca do Motor (`config.rs` e o consumidor do stream em `bus/`). Para testar sem o Gateway, envie
   comandos com `redis-cli XADD orders '*' ...` usando as fixtures.

Cuidados:

- O `main.rs` é seu. Mantenha o `sqlx::migrate!` no começo dele.
- No compose, o `engine` continua com `restart: "no"` até existir o laço principal. Só então troque para
  `unless-stopped`.
- Vocês dois mexem no `apps/engine/Cargo.toml`. Combine com o Dev 3 para não brigarem nas dependências.

### Dev 3 — Núcleo do Motor (Rust puro)

1. Crie `apps/engine/src/lib.rs` com `pub mod domain;`. **Não mexa no `main.rs`**, que é do Dev 2.
2. Comece por `domain/dinheiro.rs`: `Preco`, `Dinheiro` (`rust_decimal::Decimal`, 2 casas) e `Quantidade`. Os
   construtores recusam valores ≤ 0.
3. Depois `domain/ordem.rs` (`Ordem`, `Lado`, `StatusOrdem`) e o início de `domain/livro.rs` (por lado,
   `BTreeMap<Preco, VecDeque<Ordem>>`, desempate por `id`).
4. Escreva testes unitários desde o primeiro arquivo. O alvo é ≥ 90% de cobertura no `domain`.

Regras do `domain/` (arquitetura §3.3):

- proibido `async`, `sqlx`, `redis`, `tokio` e `Utc::now()`; o horário, quando precisar, entra como parâmetro;
- sem `unwrap()`/`expect()` (o clippy já barra);
- toda função pública tem comentário de documentação e cita o requisito que implementa (`// RF-015: ...`).

Você não depende de ninguém. Se o repositório travar por qualquer motivo, continue num crate local e traga
o código depois.

### Dev 4 — Autenticação + Home Broker

1. **Primeira coisa do dia: e-mail ao professor**, com cópia para o grupo:
   - SD-02/AP-04: bibliotecas contam como "código de terceiros"? Uma resposta negativa obriga a replanejar
     a stack, por isso é urgente;
   - Q-01: nomes e matrículas dos integrantes (prazo 07/10);
   - Q-02: confirmação dos valores iniciais (3 ativos, R$ 100.000 e 1.000 ações).
2. **Contratos do lado da tela:** JSON Schemas `evento-mercado` (`SNAPSHOT`, `ORDEM_ATUALIZADA`, `NEGOCIO`,
   `PRECO`, `LIVRO`, `PRESENCA`, `ERRO`) e `api-rest` (rotas da P1 e formato de erro), com fixtures.
   O `api-rest` precisa incluir os códigos de erro que o Gateway já usa, que estão em
   `apps/gateway/src/common/app-error.ts`, no PR `feat/gateway-base`.
3. Em `packages/contracts/src/`: `dinheiro.ts` (conversão string ⇄ centavos inteiros, nunca `number` com
   decimais), as constantes de `stage` do RF-025 e o lado TS do **T-14** (Vitest + ajv lendo as fixtures).
4. **Revisar o PR `feat/gateway-base`** do Dev 1. É a base do seu `auth`.
5. Em seguida, **`gateway/auth` + seed**, até ~08/10, porque todo mundo depende do login: cadastro, login,
   argon2, JWT e guard para REST e WebSocket, até o **T-12**. Use o que já existe:
   - `DatabaseService.transacao()` para criar o investidor e as posições iniciais juntos;
   - `AppError` com `USUARIO_JA_EXISTE`, `CREDENCIAIS_INVALIDAS` e `NAO_AUTENTICADO`;
   - `config.get('JWT_SECRET', { infer: true })` e as demais variáveis, que já são validadas ao subir;
   - o decorator `@UsuarioAtual` ainda não existe. Ele fica em `common/`, mas o formato do JWT é decisão sua.

### Critério de "Dia 0 fechado"

- `packages/contracts` v0 integrado na `main`, com schemas, fixtures e o T-14 passando em TS e em Rust;
- `feat/gateway-base` integrado;
- tipos do domínio com testes na `main` (ou em PR);
- e-mail ao professor enviado.

A partir daí ninguém precisa esperar ninguém até o **ponto de controle de 10/10** (plano §3.3).

## Pré-requisitos

| Ferramenta              | Versão               | Para quê                                                                    |
| ----------------------- | -------------------- | --------------------------------------------------------------------------- |
| Docker + Docker Compose | Compose v2           | Subir Postgres, Redis e os serviços                                         |
| Node.js                 | 22 ou mais recente   | Apps TypeScript                                                             |
| pnpm                    | 10                   | Workspace TypeScript (`corepack enable` instala a versão do `package.json`) |
| Rust                    | 1.94 ou mais recente | Motor de Negociação                                                         |

## Como rodar

```bash
git clone <url-do-repositorio> simulador-bolsa
cd simulador-bolsa
cp .env.example .env
docker compose up --build
```

Na primeira subida:

1. O **Postgres 16** cria o banco `bolsa` e roda `db/init/`, que cria os papéis `engine_app` e `gateway_app`.
2. O **Redis 7** sobe.
3. O **Motor** (`engine`) espera o Postgres ficar saudável, aplica as migrações de `db/migrations/` e
   **sai com código 0**. Por enquanto é só isso que ele faz. A linha `engine-1 | migrações aplicadas`
   no log confirma que deu certo.

Para conferir o banco:

```bash
docker compose exec postgres psql -U engine_app -d bolsa -c '\dt'
docker compose exec postgres psql -U engine_app -d bolsa -c 'select codigo, preco_atual from ativos'
```

Para começar do zero (apaga o volume do banco e roda `db/init` de novo):

```bash
docker compose down -v
```

> O `db/init/` só roda quando o volume do Postgres é criado. Se mudar senhas no `.env`, rode
> `docker compose down -v` antes de subir de novo.

### Rodando apps fora do Docker

Postgres e Redis ficam publicados **só em `127.0.0.1`** (portas `POSTGRES_PORT` e `REDIS_PORT` do `.env`).
Com o compose de pé, dá para rodar qualquer app na máquina:

```bash
# Motor: aplica as migrações no banco do compose
DATABASE_URL=postgres://engine_app:engine_dev@localhost:5432/bolsa cargo run -p engine

# Gateway (porta GATEWAY_PORT; lê o .env da raiz e não sobe se faltar variável ou banco)
pnpm install
pnpm --filter @bolsa/gateway start:dev

# Home Broker
pnpm --filter @bolsa/web dev

# Redis: enviar um comando de teste ao stream (plano §3.3)
docker compose exec redis redis-cli XADD orders '*' payload '{...}'
```

## Testes e padronização

```bash
pnpm install
pnpm lint            # ESLint (typescript-eslint + no-floating-promises)
pnpm format:check    # Prettier
pnpm -r test         # Jest no Gateway, Vitest no resto
# e2e do Gateway: precisa do Postgres com as migrações (docker compose up -d --wait postgres && docker compose up engine)
pnpm --filter @bolsa/gateway test:e2e

cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

## Estrutura

```
apps/
  gateway/      NestJS — borda REST + WebSocket
  engine/       Rust — Motor de Negociação (único escritor de dinheiro)
  web/          Next.js — Home Broker (exportação estática, só cliente)
  agents/       Node/TS — agentes (NPCs)
packages/
  contracts/    JSON Schemas + fixtures: fonte única dos formatos de mensagem
db/
  init/         cria os papéis engine_app e gateway_app (1ª subida do Postgres)
  migrations/   SQL numerado, aplicado pelo Motor com sqlx::migrate!
docs/           requisitos, system design, modelo de dados, arquitetura, plano
```

Detalhes e regras em [`docs/software_architecture_and_patterns.md`](docs/software_architecture_and_patterns.md).

## Banco de dados

- **Fonte do schema:** [`docs/simulador-bolsa.dbml`](docs/simulador-bolsa.dbml) → `db/migrations/0001_schema.sql`.
  Mudou o DBML? Crie uma **nova** migração (`0004_...sql`). Nunca edite uma migração já integrada na `main`:
  o `sqlx` guarda o checksum e o Motor recusa subir se ele mudar.
- **Quem aplica:** o Motor, ao subir (`sqlx::migrate!`). O Gateway não tem migrações.
- **Papéis** (`0003_grants.sql`):

| Papel         | Pode                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------ |
| `engine_app`  | Tudo (dono das tabelas). É o único escritor de dinheiro, ações, ordens e negócios.                                 |
| `gateway_app` | `SELECT` em tudo; `INSERT` só nas colunas de cadastro de `investidores` e `posicoes`. Nenhum `UPDATE` ou `DELETE`. |

- **CHECKs:** todos os da seção "Regras de integridade no banco" de
  [`docs/simulador-bolsa-modelo-explicado.md`](docs/simulador-bolsa-modelo-explicado.md), mais
  `preco_referencia > 0` (divisor da variação % do RF-006).

## Variáveis de ambiente

Todas estão em [`.env.example`](.env.example), com valores de desenvolvimento. O `.env` real não é versionado.
