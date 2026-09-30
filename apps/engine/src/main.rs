//! Motor de Negociação: único escritor de dinheiro, ações, ordens e negócios.
//!
//! Dia 0: só aplica as migrações de `db/migrations` e sai. Config, consumo do
//! stream, recuperação do livro e o laço principal entram depois (arquitetura §2).

use anyhow::Context;
use sqlx::postgres::PgPoolOptions;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let database_url =
        std::env::var("DATABASE_URL").context("variável DATABASE_URL não definida")?;

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&database_url)
        .await
        .context("falha ao conectar no Postgres")?;

    sqlx::migrate!("../../db/migrations")
        .run(&pool)
        .await
        .context("falha ao aplicar as migrações")?;

    println!("migrações aplicadas");
    Ok(())
}
