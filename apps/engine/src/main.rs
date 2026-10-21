//! Motor de Negociação: único escritor de dinheiro, ações, ordens e negócios.
//!
//! Sobe nesta ordem: config → Postgres → migrações → estado reconstruído do banco →
//! Redis → comandos pendentes → laço principal (arquitetura §2, RF-024).

use anyhow::Context;
use engine::bus::{Consumidor, EntradaStream, Publicador};
use engine::config::Config;
use engine::contract::stage;
use engine::processor::{Entrada, Processador};
use sqlx::postgres::PgPoolOptions;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tracing::{error, info};

/// Quanto o XREADGROUP espera por comandos antes de olhar o sinal de parada de novo.
const ESPERA_STREAM_MS: usize = 1000;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .json()
        .flatten_event(true)
        .with_current_span(false)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    if let Err(erro) = rodar().await {
        error!(erro = format!("{erro:#}"), "Motor encerrado por falha");
        return Err(erro);
    }
    Ok(())
}

async fn rodar() -> anyhow::Result<()> {
    let config = Config::do_ambiente()?;

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&config.database_url)
        .await
        .context("falha ao conectar no Postgres")?;
    sqlx::migrate!("../../db/migrations")
        .run(&pool)
        .await
        .context("falha ao aplicar as migrações")?;
    info!("migrações aplicadas");

    let mut processador = Processador::iniciar(pool, config.ordem_timeout_ms)
        .await
        .context("falha ao reconstruir o estado")?;

    let redis = redis::Client::open(config.redis_url.as_str()).context("REDIS_URL inválida")?;
    let mut consumidor = Consumidor::conectar(&redis, &config.consumidor)
        .await
        .context("falha ao conectar no Redis")?;
    let mut publicador = Publicador::conectar(&redis).await?;

    // Batimento separado do laço: um comando demorado não faz o Motor parecer morto
    let mut batimento = publicador.clone();
    let tarefa_batimento = tokio::spawn(async move {
        let mut intervalo = tokio::time::interval(Duration::from_secs(1));
        loop {
            intervalo.tick().await;
            if let Err(erro) = batimento.bater(agora_ms()).await {
                error!(erro = %erro, "falha ao renovar o batimento");
            }
        }
    });

    let pendentes = consumidor.pendentes().await?;
    info!(pendentes = pendentes.len(), "Motor pronto");
    for entrada in pendentes {
        tratar(&mut processador, &mut publicador, &mut consumidor, entrada).await?;
    }

    // SIGINT (Ctrl+C) ou SIGTERM (docker compose stop): termina o comando atual e sai
    let mut sigterm = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .context("falha ao instalar o tratamento de SIGTERM")?;
    let parar = tokio::signal::ctrl_c();
    tokio::pin!(parar);
    loop {
        tokio::select! {
            _ = &mut parar => {
                info!("sinal de parada recebido");
                break;
            }
            _ = sigterm.recv() => {
                info!("SIGTERM recebido");
                break;
            }
            lidas = consumidor.proximas(ESPERA_STREAM_MS) => {
                for entrada in lidas? {
                    tratar(&mut processador, &mut publicador, &mut consumidor, entrada).await?;
                }
            }
        }
    }
    tarefa_batimento.abort();
    Ok(())
}

/// Um comando: processa (com COMMIT), publica e só então dá XACK (RF-024). Se publicar
/// falhar, a entrada fica pendente e é republicada pela idempotência na próxima subida.
async fn tratar(
    processador: &mut Processador,
    publicador: &mut Publicador,
    consumidor: &mut Consumidor,
    entrada: EntradaStream,
) -> anyhow::Result<()> {
    let resultado = processador
        .processar(
            &Entrada {
                stream_id: &entrada.id,
                payload: entrada.payload.as_deref(),
            },
            agora_ms(),
        )
        .await?;
    if let Some(resultado) = resultado {
        publicador.publicar(&resultado).await?;
        info!(
            stage = stage::CLIENTS_NOTIFIED,
            streamId = entrada.id.as_str(),
            clientOrderId = resultado.client_order_id.as_str(),
            orderId = resultado.ordem.as_ref().map(|o| o.id),
            "resultado publicado"
        );
    }
    consumidor.confirmar(&entrada.id).await?;
    Ok(())
}

fn agora_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}
