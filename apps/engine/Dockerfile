# Build a partir da raiz do repositório (contexto "."), porque o binário
# embute db/migrations via sqlx::migrate!.
FROM rust:1.96-slim-bookworm AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock rustfmt.toml clippy.toml ./
COPY apps/engine apps/engine
COPY db/migrations db/migrations
RUN cargo build --release --locked -p engine

FROM debian:bookworm-slim
COPY --from=build /src/target/release/engine /usr/local/bin/engine
CMD ["engine"]
