# Simulador de Bolsa de Valores Multiplayer

Trabalho de Sistemas Distribuídos (UFS). Os documentos de requisitos, arquitetura, modelo de dados e o
plano de implementação estão em [`docs/`](docs/).

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

# Gateway (Nest vazio por enquanto, porta GATEWAY_PORT)
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
