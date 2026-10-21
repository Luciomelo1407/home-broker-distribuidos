//! Integração do processor com o Postgres real: T-07, T-08, T-09 e T-11.
//!
//! Precisa de `TEST_DATABASE_URL` apontando para um banco com as migrações (o do compose
//! serve: `postgres://engine_app:engine_dev@localhost:5432/bolsa`). Sem ela, o teste
//! avisa e passa, para que `cargo test` continue rodando sem Docker.
#![allow(clippy::unwrap_used, clippy::expect_used)] // testes: permitido pela regra 3.3.6

use engine::contract::{MotivoRejeicao, ResultadoOrdem, StatusContrato};
use engine::processor::{Entrada, Processador};
use rust_decimal::Decimal;
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

const TIMEOUT_MS: u64 = 3000;
static SEQUENCIA: AtomicU64 = AtomicU64::new(0);

fn agora_ms() -> u64 {
    u64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis(),
    )
    .unwrap()
}

/// ID de stream novo, no formato do Redis, com o horário de chegada dado.
fn stream_id(chegada_ms: u64) -> String {
    format!("{chegada_ms}-{}", SEQUENCIA.fetch_add(1, Ordering::Relaxed))
}

fn uuid() -> String {
    let n = u128::from(agora_ms()) << 20 | u128::from(SEQUENCIA.fetch_add(1, Ordering::Relaxed));
    let h = format!("{n:032x}");
    format!(
        "{}-{}-4{}-8{}-{}",
        &h[0..8],
        &h[8..12],
        &h[13..16],
        &h[17..20],
        &h[20..32]
    )
}

/// Investidor novo com R$ 100.000 e 1.000 ações de cada ativo (S-01).
async fn investidor(pool: &PgPool) -> i32 {
    let nome = format!(
        "t-{}-{}",
        agora_ms(),
        SEQUENCIA.fetch_add(1, Ordering::Relaxed)
    );
    let id: i32 = sqlx::query_scalar(
        "INSERT INTO investidores (nome_usuario, senha_hash, saldo_disponivel)
         VALUES ($1, 'x', 100000.00) RETURNING id",
    )
    .bind(&nome)
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO posicoes (investidor_id, ativo_id, quantidade_disponivel)
         SELECT $1, id, 1000 FROM ativos",
    )
    .bind(id)
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn saldo(pool: &PgPool, investidor: i32) -> (Decimal, Decimal) {
    sqlx::query_as("SELECT saldo_disponivel, saldo_reservado FROM investidores WHERE id = $1")
        .bind(investidor)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn acoes(pool: &PgPool, investidor: i32, ativo: &str) -> (i32, i32) {
    sqlx::query_as(
        "SELECT quantidade_disponivel, quantidade_reservada FROM posicoes p
           JOIN ativos a ON a.id = p.ativo_id WHERE investidor_id = $1 AND a.codigo = $2",
    )
    .bind(investidor)
    .bind(ativo)
    .fetch_one(pool)
    .await
    .unwrap()
}

fn criar(cliente: &str, investidor: i32, ativo: &str, lado: &str, qtd: u32, preco: &str) -> String {
    format!(
        r#"{{"tipo":"CRIAR","clientOrderId":"{cliente}","investidorId":{investidor},"ativo":"{ativo}","lado":"{lado}","quantidade":{qtd},"preco":"{preco}"}}"#
    )
}

async fn enviar(p: &mut Processador, payload: &str, chegada_ms: u64) -> ResultadoOrdem {
    let id = stream_id(chegada_ms);
    p.processar(
        &Entrada {
            stream_id: &id,
            payload: Some(payload),
        },
        agora_ms(),
    )
    .await
    .unwrap()
    .expect("comando dentro do contrato gera resultado")
}

/// Os cenários rodam em sequência num teste só: compartilham o banco, e o T-07 compara o
/// livro inteiro, que outro teste em paralelo mudaria.
#[tokio::test]
async fn processor_contra_postgres() {
    let Ok(url) = std::env::var("TEST_DATABASE_URL") else {
        eprintln!("TEST_DATABASE_URL não definida: integração do processor pulada");
        return;
    };
    let pool = PgPoolOptions::new()
        .max_connections(3)
        .connect(&url)
        .await
        .unwrap();
    sqlx::migrate!("../../db/migrations")
        .run(&pool)
        .await
        .unwrap();
    let mut p = Processador::iniciar(pool.clone(), TIMEOUT_MS)
        .await
        .unwrap();

    t08_comando_repetido_gera_uma_ordem(&pool, &mut p).await;
    t09_comando_vencido_e_descartado(&pool, &mut p).await;
    t11_cancelar_parcial_devolve_a_reserva_restante(&pool, &mut p).await;
    cancelar_ordem_de_outro_nao_revela_nada(&pool, &mut p).await;
    investidor_inexistente_e_descartado(&mut p).await;
    t07_livro_reconstruido_igual(&pool, &p).await;
}

async fn investidor_inexistente_e_descartado(p: &mut Processador) {
    let id = stream_id(agora_ms());
    let comando = criar(&uuid(), i32::MAX, "ABC3", "COMPRA", 1, "1.00");

    let resultado = p
        .processar(
            &Entrada {
                stream_id: &id,
                payload: Some(&comando),
            },
            agora_ms(),
        )
        .await;

    assert!(
        matches!(resultado, Ok(None)),
        "deveria descartar sem parar o Motor"
    );
}

async fn t08_comando_repetido_gera_uma_ordem(pool: &PgPool, p: &mut Processador) {
    let a = investidor(pool).await;
    let cliente = uuid();
    let comando = criar(&cliente, a, "ABC3", "COMPRA", 10, "1.00");

    let primeiro = enviar(p, &comando, agora_ms()).await;
    let segundo = enviar(p, &comando, agora_ms()).await;

    assert_eq!(primeiro.ordem, segundo.ordem);
    let total: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM ordens WHERE investidor_id = $1 AND client_order_id = $2::uuid",
    )
    .bind(a)
    .bind(&cliente)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(total, 1);
    // Reservou uma vez só: 10 × 1,00
    assert_eq!(
        saldo(pool, a).await,
        (Decimal::new(9_999_000, 2), Decimal::new(1000, 2))
    );
}

async fn t09_comando_vencido_e_descartado(pool: &PgPool, p: &mut Processador) {
    let a = investidor(pool).await;
    let antes = saldo(pool, a).await;
    let comando = criar(&uuid(), a, "ABC3", "COMPRA", 10, "1.00");

    let resultado = enviar(p, &comando, agora_ms() - TIMEOUT_MS - 1).await;

    let ordem = resultado.ordem.unwrap();
    assert_eq!(ordem.status, StatusContrato::Rejeitada);
    assert_eq!(ordem.motivo_rejeicao, Some(MotivoRejeicao::ComandoExpirado));
    assert_eq!(saldo(pool, a).await, antes);
}

async fn t11_cancelar_parcial_devolve_a_reserva_restante(pool: &PgPool, p: &mut Processador) {
    let (vendedor, comprador) = (investidor(pool).await, investidor(pool).await);
    // Bem acima do preço de GHI3 (R$ 10), para não casar com ordens de outros cenários
    let preco = "900.00";
    enviar(
        p,
        &criar(&uuid(), vendedor, "GHI3", "VENDA", 30, preco),
        agora_ms(),
    )
    .await;
    let compra = enviar(
        p,
        &criar(&uuid(), comprador, "GHI3", "COMPRA", 100, preco),
        agora_ms(),
    )
    .await
    .ordem
    .unwrap();
    assert_eq!(
        (compra.status, compra.quantidade_executada),
        (StatusContrato::Parcial, 30)
    );
    let (disponivel_antes, reservado_antes) = saldo(pool, comprador).await;
    assert_eq!(reservado_antes, Decimal::from(70 * 900));

    let cancelar = format!(
        r#"{{"tipo":"CANCELAR","clientOrderId":"{}","investidorId":{comprador},"ordemId":{}}}"#,
        uuid(),
        compra.id
    );
    let resultado = enviar(p, &cancelar, agora_ms()).await;

    assert_eq!(resultado.ordem.unwrap().status, StatusContrato::Cancelada);
    assert_eq!(
        saldo(pool, comprador).await,
        (disponivel_antes + reservado_antes, Decimal::ZERO)
    );
    assert_eq!(acoes(pool, comprador, "GHI3").await, (1030, 0));
    assert_eq!(acoes(pool, vendedor, "GHI3").await, (970, 0));

    // Cancelar de novo: a ordem existe, mas não é cancelável
    let de_novo = enviar(p, &cancelar.replace(&uuid()[..8], "ffffffff"), agora_ms()).await;
    assert_eq!(
        de_novo.motivo_rejeicao,
        Some(MotivoRejeicao::OrdemNaoCancelavel)
    );
}

async fn cancelar_ordem_de_outro_nao_revela_nada(pool: &PgPool, p: &mut Processador) {
    let (a, b) = (investidor(pool).await, investidor(pool).await);
    let ordem = enviar(
        p,
        &criar(&uuid(), a, "ABC3", "COMPRA", 1, "1.00"),
        agora_ms(),
    )
    .await
    .ordem
    .unwrap();
    let cancelar = format!(
        r#"{{"tipo":"CANCELAR","clientOrderId":"{}","investidorId":{b},"ordemId":{}}}"#,
        uuid(),
        ordem.id
    );

    let resultado = enviar(p, &cancelar, agora_ms()).await;

    assert_eq!(resultado.ordem, None);
    assert_eq!(
        resultado.motivo_rejeicao,
        Some(MotivoRejeicao::OrdemDeOutroInvestidor)
    );
}

async fn t07_livro_reconstruido_igual(pool: &PgPool, p: &Processador) {
    let reiniciado = Processador::iniciar(pool.clone(), TIMEOUT_MS)
        .await
        .unwrap();

    assert_eq!(reiniciado.estado().livros, p.estado().livros);
    assert_eq!(reiniciado.estado().mercados, p.estado().mercados);
    for (id, conta) in &reiniciado.estado().contas {
        assert_eq!(Some(conta), p.estado().contas.get(id), "conta {id}");
    }
}
