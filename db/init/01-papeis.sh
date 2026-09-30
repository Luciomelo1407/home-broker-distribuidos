#!/bin/sh
# Roda uma única vez, quando o volume do Postgres é criado (docker-entrypoint-initdb.d).
# Cria os dois papéis da aplicação. O que cada um pode fazer é definido em
# db/migrations/0003_grants.sql, aplicado pelo Motor ao subir.
set -eu

: "${ENGINE_DB_PASSWORD:?defina ENGINE_DB_PASSWORD no .env}"
: "${GATEWAY_DB_PASSWORD:?defina GATEWAY_DB_PASSWORD no .env}"

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set engine_senha="$ENGINE_DB_PASSWORD" \
  --set gateway_senha="$GATEWAY_DB_PASSWORD" \
  --set banco="$POSTGRES_DB" <<'SQL'
-- engine_app: único escritor de dinheiro, ações, ordens e negócios.
-- É dono do banco (e, portanto, do schema public) para aplicar as migrações.
CREATE ROLE engine_app LOGIN PASSWORD :'engine_senha';

-- gateway_app: lê tudo e só insere no cadastro (permissões em 0003_grants.sql).
CREATE ROLE gateway_app LOGIN PASSWORD :'gateway_senha';

ALTER DATABASE :"banco" OWNER TO engine_app;
REVOKE ALL ON DATABASE :"banco" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"banco" TO engine_app, gateway_app;
SQL
