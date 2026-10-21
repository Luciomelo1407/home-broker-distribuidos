# Simulador de Bolsa de Valores Multiplayer

Trabalho de Sistemas Distribuídos (UFS). Os documentos de requisitos, arquitetura, modelo de dados e o
plano de implementação estão em [`docs/`](docs/).

## Situação em 21/10/2026 (Parte 1)

> Seção temporária: sai do README quando os PRs abaixo estiverem na `main`. As decisões de integração
> e o impacto em cada dev estão em [`docs/integracao.md`](docs/integracao.md). **Leia antes de
> continuar o seu módulo**, porque parte dele pode já existir.

**O fluxo da Parte 1 (CA-01) funciona de ponta a ponta:** `docker compose up --build` sobe Postgres,
Redis, Motor, Gateway e Home Broker. Dois navegadores fazem cadastro e login, veem os ativos, enviam
ordens, e as duas telas se atualizam ao vivo com o negócio (testado em 21/10). O casamento já é o
real do domínio do Dev 3, não só "gravar ABERTA".

### PRs para revisar, nesta ordem

Os branches estão empilhados: cada um parte do anterior. Abra cada PR com a **base no branch
anterior** (o primeiro contra a `main`) e integre na mesma ordem.

| #   | Branch                             | O quê                                                   | Revisor sugerido  |
| --- | ---------------------------------- | ------------------------------------------------------- | ----------------- |
| 1   | `feat/ci`                          | GitHub Actions (lint, Prettier, testes TS e Rust, e2e)  | Dev 4             |
| 2   | `feat/gateway-observability`       | pino com redact, `LOG_LEVEL`                            | Dev 4             |
| 3   | `feat/gateway-mercado`             | `GET /mercado`, snapshot em memória                     | Dev 4             |
| 4   | `feat/gateway-ordens`              | `POST /ordens`, DTO, T-13, `@UsuarioAtual`              | Dev 4             |
| 5   | `feat/contracts-comando-resultado` | schemas do Redis, structs Rust, T-14 nos dois lados     | **Dev 2** + Dev 4 |
| 6   | `feat/engine-casca`                | casca do Motor: stream, store, processor, T-07/08/09/11 | **Dev 2** + Dev 3 |
| 7   | `feat/gateway-bus`                 | `gateway/bus`: XADD e espera do resultado               | **Dev 2**         |
| 8   | `feat/gateway-auth`                | cadastro, login, argon2id, JWT, T-12                    | **Dev 4**         |
| 9   | `feat/gateway-carteira`            | `GET /carteira` (P1)                                    | **Dev 4**         |
| 10  | `feat/gateway-realtime`            | WebSocket: SNAPSHOT, presença, eventos                  | Dev 2             |
| 11  | `feat/gateway-docker`              | Dockerfile do Gateway e serviço no compose              | Dev 2             |
| 12  | `feat/web-p1`                      | Home Broker P1 (login, cadastro, painel)                | **Dev 4**         |
| 13  | `docs/readme-21-10`                | esta seção                                              | qualquer um       |

Os itens 5 a 12 eram de outros devs no plano (§2). O Dev 1 os escreveu para fechar a Parte 1 a
tempo. Quem é dono do módulo revisa o PR e continua dali; `docs/integracao.md` §7 lista o que foi
decidido em nome de cada um.

### Mudanças que afetam todo mundo

- **Node 24.9 ou mais novo.** No Node 22, os testes do Gateway quebram ("Must use import to load ES
  Module").
- **`cp .env.example .env` de novo** (ou acrescente `LOG_LEVEL=info`): sem `LOG_LEVEL`, o Gateway não
  sobe.
- Os e2e e a integração do Motor escrevem no banco do compose. **Antes de uma demo:
  `docker compose down -v`.**

### O que falta (próximo ponto: F2, ~04/11)

| Dono  | Pendência                                                                                    |
| ----- | -------------------------------------------------------------------------------------------- |
| Dev 1 | esqueleto do k6 (M5), `mercado` P2 (melhores ofertas, top-5 do livro), métricas do Gateway   |
| Dev 2 | T-06 (falha forçada no meio da gravação), métricas do Motor (RF-026), roteiro da demo CA-05  |
| Dev 3 | T-05 com mais cenários, se quiser; depois `agents` (F5)                                      |
| Dev 4 | seed dos agentes, carteira P2 (patrimônio, P/L), histórico (RF-008), livro (RF-007) no `web` |
| Grupo | preço médio inicial das ações do cadastro (hoje 0; ver `docs/integracao.md` §7, Dev 4)       |

## Pré-requisitos

| Ferramenta              | Versão               | Para quê                                                                    |
| ----------------------- | -------------------- | --------------------------------------------------------------------------- |
| Docker + Docker Compose | Compose v2           | Subir Postgres, Redis e os serviços                                         |
| Node.js                 | 24.9 ou mais recente | Apps TypeScript (o Jest só carrega o Nest 12, que é ESM, a partir do 24.9)  |
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
3. O **Motor** (`engine`) espera o Postgres ficar saudável, aplica as migrações de `db/migrations/`,
   reconstrói o livro a partir das ordens abertas e passa a consumir o stream `orders`. A linha
   `"Motor pronto"` no log confirma que deu certo. Os nomes no Redis e o formato das mensagens estão
   em [`docs/integracao.md`](docs/integracao.md).
4. O **Gateway** sobe na porta `GATEWAY_PORT` (3001): REST (`/auth/*`, `/ordens`, `/mercado`,
   `/carteira`) e WebSocket (`/ws?token=<jwt>`). Se subir antes de o Motor terminar as migrações
   num banco novo, ele sai com erro e o Docker o sobe de novo em seguida.
5. O **Home Broker** (`web`) fica em `http://localhost:WEB_PORT` (3000). De outra máquina, use
   `http://<ip-da-máquina>:3000`: ele fala com o Gateway no mesmo host, porta 3001.

Para testar o fluxo inteiro com `curl`:

```bash
curl -s localhost:3001/auth/cadastro -H 'content-type: application/json' \
  -d '{"nomeUsuario":"ana","senha":"senha-123"}'
TOKEN=$(curl -s localhost:3001/auth/login -H 'content-type: application/json' \
  -d '{"nomeUsuario":"ana","senha":"senha-123"}' | sed 's/.*"token":"\([^"]*\)".*/\1/')
curl -s localhost:3001/ordens -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"clientOrderId\":\"$(uuidgen)\",\"ativo\":\"ABC3\",\"lado\":\"COMPRA\",\"quantidade\":10,\"preco\":\"25.00\"}"
curl -s localhost:3001/carteira -H "authorization: Bearer $TOKEN"
```

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
# Motor (pare o do compose antes: docker compose stop engine; o escritor é único)
DATABASE_URL=postgres://engine_app:engine_dev@localhost:5432/bolsa REDIS_URL=redis://localhost:6379 \
  ORDEM_TIMEOUT_MS=3000 cargo run -p engine

# Gateway (pare o do compose antes, por causa da porta: docker compose stop gateway)
pnpm install
pnpm --filter @bolsa/gateway start:dev

# Home Broker
pnpm --filter @bolsa/web dev

# Redis: enviar um comando de teste ao stream e ver o resultado (docs/integracao.md)
docker compose exec redis redis-cli SUBSCRIBE ordens.resultado   # em outro terminal
docker compose exec -T redis redis-cli XADD orders '*' payload "$(cat packages/contracts/fixtures/validas/comando-criar.json)"
```

## Testes e padronização

O CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) roda tudo isto em cada PR e na `main`.

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
# integração do Motor (T-07, T-08, T-09, T-11) contra o Postgres do compose,
# com o Motor do compose parado (o teste é um segundo escritor): docker compose stop engine
TEST_DATABASE_URL=postgres://engine_app:engine_dev@localhost:5432/bolsa cargo test -p engine --test processor
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
