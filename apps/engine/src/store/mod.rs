//! Persistência do Motor (sqlx). Carrega o estado ao subir (RF-024) e grava cada
//! `Resultado` do domínio numa única transação (RF-016).
//!
//! As consultas usam `query` com tipos em tempo de execução, não as macros, para que o
//! build não precise de um banco nem de cache offline do sqlx.

use crate::contract::{
    LadoContrato, MotivoRejeicao, NegocioContrato, OrdemContrato, StatusContrato, texto_dinheiro,
};
use crate::domain::{
    Conta, Dinheiro, Estado, Lado, Mercado, Ordem, Posicao, Preco, Quantidade, Resultado, Status,
};
use rust_decimal::Decimal;
use sqlx::postgres::PgRow;
use sqlx::{PgPool, Postgres, Row, Transaction};
use std::collections::{BTreeMap, BTreeSet, HashMap};

/// Falha de infraestrutura ou dado do banco que viola o modelo. Nos dois casos o
/// processor para (fail-fast) e o estado é reconstruído na próxima subida.
#[derive(Debug, thiserror::Error)]
pub enum ErroStore {
    #[error("Postgres: {0}")]
    Banco(#[from] sqlx::Error),
    #[error("dado inconsistente no banco: {0}")]
    Inconsistente(String),
}

// Colunas de `ordens` no formato que `ordem_contrato` lê. São macros, e não `const`,
// porque o sqlx 0.9 só aceita SQL estático, e `concat!` só junta literais.
macro_rules! colunas_ordem {
    () => {
        "id, client_order_id::text AS client_order_id, investidor_id, ativo_id, \
         lado::text AS lado, preco_limite, quantidade, quantidade_executada, \
         status::text AS status, motivo_rejeicao"
    };
}

macro_rules! insert_ordem {
    () => {
        "INSERT INTO ordens (id, investidor_id, ativo_id, client_order_id, stream_id, lado, \
         preco_limite, quantidade, quantidade_executada, status, motivo_rejeicao) "
    };
}

/// Códigos ⇄ ids dos ativos. O conjunto é fixo (0002_ativos.sql).
#[derive(Clone, Debug, Default)]
pub struct Catalogo {
    por_codigo: HashMap<String, i32>,
    por_id: BTreeMap<i32, String>,
}

impl Catalogo {
    /// Id do ativo pelo código do contrato.
    pub fn id(&self, codigo: &str) -> Option<i32> {
        self.por_codigo.get(codigo).copied()
    }

    /// Código do ativo pelo id do banco.
    pub fn codigo(&self, id: i32) -> Result<&str, ErroStore> {
        self.por_id
            .get(&id)
            .map(String::as_str)
            .ok_or_else(|| inconsistente(format!("ativo {id} fora do catálogo")))
    }

    fn inserir(&mut self, id: i32, codigo: String) {
        self.por_codigo.insert(codigo.clone(), id);
        self.por_id.insert(id, codigo);
    }
}

/// Estado em memória reconstruído do Postgres (RF-024, T-07).
pub struct Carga {
    pub estado: Estado,
    pub catalogo: Catalogo,
}

/// Lê ativos, ordens abertas/parciais (o livro) e as contas dos donos dessas ordens.
/// O livro sai na mesma prioridade de antes da queda, porque o desempate é o `id` (RF-014).
pub async fn carregar(pool: &PgPool) -> Result<Carga, ErroStore> {
    let mut estado = Estado::default();
    let mut catalogo = Catalogo::default();

    let ativos = sqlx::query(
        "SELECT id, codigo, preco_referencia, preco_atual, volume_negociado FROM ativos",
    )
    .fetch_all(pool)
    .await?;
    for linha in ativos {
        let id: i32 = linha.try_get("id")?;
        catalogo.inserir(id, linha.try_get("codigo")?);
        estado.mercados.insert(
            id,
            Mercado {
                referencia: preco(linha.try_get("preco_referencia")?)?,
                ultimo: preco(linha.try_get("preco_atual")?)?,
                volume: linha.try_get("volume_negociado")?,
            },
        );
    }

    let abertas = sqlx::query(
        "SELECT id, investidor_id, ativo_id, lado::text AS lado, preco_limite, quantidade,
                quantidade_executada, status::text AS status
           FROM ordens
          WHERE status IN ('ABERTA', 'PARCIAL')
          ORDER BY id",
    )
    .fetch_all(pool)
    .await?;
    let mut donos = BTreeSet::new();
    for linha in abertas {
        let ordem = ordem_do_banco(&linha)?;
        donos.insert(ordem.investidor_id);
        estado
            .livros
            .entry(ordem.ativo_id)
            .or_default()
            .inserir(ordem.clone())
            .map_err(|r| inconsistente(format!("ordem {} não entra no livro: {r:?}", ordem.id)))?;
        estado.ordens.insert(ordem.id, ordem);
    }
    for investidor in donos {
        let conta = carregar_conta(pool, investidor)
            .await?
            .ok_or_else(|| inconsistente(format!("investidor {investidor} sem conta")))?;
        estado.contas.insert(investidor, conta);
    }
    Ok(Carga { estado, catalogo })
}

/// Saldo e posições de um investidor. `None` se ele não existe.
pub async fn carregar_conta(pool: &PgPool, investidor_id: i32) -> Result<Option<Conta>, ErroStore> {
    let Some(linha) =
        sqlx::query("SELECT saldo_disponivel, saldo_reservado FROM investidores WHERE id = $1")
            .bind(investidor_id)
            .fetch_optional(pool)
            .await?
    else {
        return Ok(None);
    };
    let mut conta = Conta {
        disponivel: dinheiro(linha.try_get("saldo_disponivel")?)?,
        reservado: dinheiro(linha.try_get("saldo_reservado")?)?,
        posicoes: BTreeMap::new(),
    };
    let posicoes = sqlx::query(
        "SELECT ativo_id, quantidade_disponivel, quantidade_reservada, preco_medio
           FROM posicoes WHERE investidor_id = $1",
    )
    .bind(investidor_id)
    .fetch_all(pool)
    .await?;
    for linha in posicoes {
        conta.posicoes.insert(
            linha.try_get("ativo_id")?,
            Posicao {
                disponivel: nao_negativo(linha.try_get("quantidade_disponivel")?)?,
                reservada: nao_negativo(linha.try_get("quantidade_reservada")?)?,
                preco_medio: linha.try_get("preco_medio")?,
            },
        );
    }
    Ok(Some(conta))
}

/// Idempotência (system design §4, T-08): a ordem que este comando já criou, se houver.
pub async fn buscar_por_cliente(
    pool: &PgPool,
    catalogo: &Catalogo,
    investidor_id: i32,
    client_order_id: &str,
) -> Result<Option<OrdemContrato>, ErroStore> {
    let linha = sqlx::query(concat!(
        "SELECT ",
        colunas_ordem!(),
        " FROM ordens WHERE investidor_id = $1 AND client_order_id = $2::uuid"
    ))
    .bind(investidor_id)
    .bind(client_order_id)
    .fetch_optional(pool)
    .await?;
    linha.map(|l| ordem_contrato(&l, catalogo)).transpose()
}

/// Uma ordem pelo id, para responder cancelamentos de ordens fora do livro.
pub async fn buscar_por_id(
    pool: &PgPool,
    catalogo: &Catalogo,
    ordem_id: i64,
) -> Result<Option<OrdemContrato>, ErroStore> {
    let linha = sqlx::query(concat!(
        "SELECT ",
        colunas_ordem!(),
        " FROM ordens WHERE id = $1"
    ))
    .bind(ordem_id)
    .fetch_optional(pool)
    .await?;
    linha.map(|l| ordem_contrato(&l, catalogo)).transpose()
}

/// Reserva o próximo `ordens.id`. O domínio precisa do id antes de casar, porque ele é
/// o desempate por tempo (RF-014). Um id reservado e não usado só deixa um buraco.
pub async fn proximo_id_ordem(pool: &PgPool) -> Result<i64, ErroStore> {
    Ok(
        sqlx::query_scalar("SELECT nextval(pg_get_serial_sequence('ordens', 'id'))")
            .fetch_one(pool)
            .await?,
    )
}

/// Dados da ordem que o domínio não guarda.
pub struct NovaOrdem<'a> {
    pub client_order_id: &'a str,
    pub stream_id: &'a str,
}

/// Grava uma ordem recusada (RF-011): `REJEITADA` com o motivo, sem mexer em saldo.
pub async fn gravar_rejeicao(
    pool: &PgPool,
    catalogo: &Catalogo,
    ordem: &Ordem,
    nova: &NovaOrdem<'_>,
    motivo: MotivoRejeicao,
) -> Result<OrdemContrato, ErroStore> {
    let linha = sqlx::query(concat!(
        insert_ordem!(),
        "VALUES ($1, $2, $3, $4::uuid, $5, $6::lado_ordem, $7, $8, 0, 'REJEITADA', $9) RETURNING ",
        colunas_ordem!()
    ))
    .bind(ordem.id)
    .bind(ordem.investidor_id)
    .bind(ordem.ativo_id)
    .bind(nova.client_order_id)
    .bind(nova.stream_id)
    .bind(lado_banco(ordem.lado))
    .bind(ordem.preco.valor())
    .bind(quantidade_banco(ordem.quantidade.valor())?)
    .bind(motivo.codigo())
    .fetch_one(pool)
    .await?;
    ordem_contrato(&linha, catalogo)
}

/// O que a transação gravou e o processor publica.
pub struct Gravado {
    pub ordens: Vec<OrdemContrato>,
    pub negocios: Vec<NegocioContrato>,
}

/// RF-016: grava tudo o que o `Resultado` mudou numa única transação. Se qualquer
/// passo falhar, nada fica gravado e o estado em memória não é trocado (T-06).
///
/// `nova` é `Some` para `CRIAR` (a ordem `ordem_principal` ainda não existe no banco) e
/// `None` para `CANCELAR`.
pub async fn gravar_resultado(
    pool: &PgPool,
    catalogo: &Catalogo,
    resultado: &Resultado,
    ordem_principal: i64,
    nova: Option<&NovaOrdem<'_>>,
) -> Result<Gravado, ErroStore> {
    let mut tx = pool.begin().await?;
    let estado = &resultado.estado;
    let ordem_de = |id: i64| {
        estado
            .ordens
            .get(&id)
            .ok_or_else(|| inconsistente(format!("ordem {id} fora do resultado")))
    };

    let mut ordens = Vec::new();
    for &id in &resultado.ordens_alteradas {
        let ordem = ordem_de(id)?;
        let linha = if id == ordem_principal
            && let Some(nova) = nova
        {
            inserir_ordem(&mut tx, ordem, nova).await?
        } else {
            atualizar_ordem(&mut tx, ordem).await?
        };
        ordens.push(ordem_contrato(&linha, catalogo)?);
    }

    let mut negocios = Vec::new();
    for execucao in &resultado.execucoes {
        let ativo_id = ordem_de(execucao.compra_id)?.ativo_id;
        let linha = sqlx::query(
            "INSERT INTO negocios (ativo_id, ordem_compra_id, ordem_venda_id, preco, quantidade)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id,
                       to_char(executado_em, 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS momento",
        )
        .bind(ativo_id)
        .bind(execucao.compra_id)
        .bind(execucao.venda_id)
        .bind(execucao.preco.valor())
        .bind(quantidade_banco(execucao.quantidade)?)
        .fetch_one(&mut *tx)
        .await?;
        negocios.push(NegocioContrato {
            id: linha.try_get("id")?,
            ativo: catalogo.codigo(ativo_id)?.to_owned(),
            preco: texto_dinheiro(execucao.preco.valor()),
            quantidade: execucao.quantidade,
            momento: linha.try_get("momento")?,
        });
    }

    // Contas e posições de todos os donos das ordens alteradas, no ativo da ordem
    let mut afetados = BTreeSet::new();
    for &id in &resultado.ordens_alteradas {
        let ordem = ordem_de(id)?;
        afetados.insert((ordem.investidor_id, ordem.ativo_id));
    }
    let mut contas_gravadas = BTreeSet::new();
    for &(investidor, ativo) in &afetados {
        let conta = estado
            .contas
            .get(&investidor)
            .ok_or_else(|| inconsistente(format!("conta {investidor} fora do resultado")))?;
        if contas_gravadas.insert(investidor) {
            sqlx::query(
                "UPDATE investidores SET saldo_disponivel = $2, saldo_reservado = $3 WHERE id = $1",
            )
            .bind(investidor)
            .bind(conta.disponivel.valor())
            .bind(conta.reservado.valor())
            .execute(&mut *tx)
            .await?;
        }
        if let Some(posicao) = conta.posicoes.get(&ativo) {
            sqlx::query(
                "INSERT INTO posicoes
                        (investidor_id, ativo_id, quantidade_disponivel, quantidade_reservada,
                         preco_medio)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (investidor_id, ativo_id) DO UPDATE
                    SET quantidade_disponivel = EXCLUDED.quantidade_disponivel,
                        quantidade_reservada  = EXCLUDED.quantidade_reservada,
                        preco_medio           = EXCLUDED.preco_medio,
                        atualizado_em         = now()",
            )
            .bind(investidor)
            .bind(ativo)
            .bind(quantidade_banco(posicao.disponivel)?)
            .bind(quantidade_banco(posicao.reservada)?)
            .bind(posicao.preco_medio)
            .execute(&mut *tx)
            .await?;
        }
    }

    // RF-017: preço atual e volume dos ativos negociados
    let ativos: BTreeSet<i32> = afetados.iter().map(|(_, ativo)| *ativo).collect();
    if !resultado.execucoes.is_empty() {
        for ativo in ativos {
            let mercado = estado
                .mercados
                .get(&ativo)
                .ok_or_else(|| inconsistente(format!("mercado {ativo} fora do resultado")))?;
            sqlx::query(
                "UPDATE ativos SET preco_atual = $2, volume_negociado = $3, atualizado_em = now()
                  WHERE id = $1",
            )
            .bind(ativo)
            .bind(mercado.ultimo.valor())
            .bind(mercado.volume)
            .execute(&mut *tx)
            .await?;
        }
    }

    tx.commit().await?;
    Ok(Gravado { ordens, negocios })
}

async fn inserir_ordem(
    tx: &mut Transaction<'_, Postgres>,
    ordem: &Ordem,
    nova: &NovaOrdem<'_>,
) -> Result<PgRow, ErroStore> {
    Ok(sqlx::query(concat!(
        insert_ordem!(),
        "VALUES ($1, $2, $3, $4::uuid, $5, $6::lado_ordem, $7, $8, $9, $10::status_ordem, NULL) \
         RETURNING ",
        colunas_ordem!()
    ))
    .bind(ordem.id)
    .bind(ordem.investidor_id)
    .bind(ordem.ativo_id)
    .bind(nova.client_order_id)
    .bind(nova.stream_id)
    .bind(lado_banco(ordem.lado))
    .bind(ordem.preco.valor())
    .bind(quantidade_banco(ordem.quantidade.valor())?)
    .bind(quantidade_banco(ordem.executada())?)
    .bind(status_banco(ordem.status()))
    .fetch_one(&mut **tx)
    .await?)
}

async fn atualizar_ordem(
    tx: &mut Transaction<'_, Postgres>,
    ordem: &Ordem,
) -> Result<PgRow, ErroStore> {
    Ok(sqlx::query(concat!(
        "UPDATE ordens SET quantidade_executada = $2, status = $3::status_ordem, \
         atualizado_em = now() WHERE id = $1 RETURNING ",
        colunas_ordem!()
    ))
    .bind(ordem.id)
    .bind(quantidade_banco(ordem.executada())?)
    .bind(status_banco(ordem.status()))
    .fetch_one(&mut **tx)
    .await?)
}

fn ordem_do_banco(linha: &PgRow) -> Result<Ordem, ErroStore> {
    let id: i64 = linha.try_get("id")?;
    let quantidade = Quantidade::nova(nao_negativo(linha.try_get("quantidade")?)?)
        .map_err(|_| inconsistente(format!("ordem {id} com quantidade inválida")))?;
    let nova = Ordem::nova(
        id,
        linha.try_get("investidor_id")?,
        linha.try_get("ativo_id")?,
        lado_do_banco(&linha.try_get::<String, _>("lado")?)?,
        preco(linha.try_get("preco_limite")?)?,
        quantidade,
    );
    Ordem::restaurar(
        nova,
        nao_negativo(linha.try_get("quantidade_executada")?)?,
        status_do_banco(&linha.try_get::<String, _>("status")?)?,
    )
    .map_err(|_| inconsistente(format!("ordem {id} com status e execução incoerentes")))
}

fn ordem_contrato(linha: &PgRow, catalogo: &Catalogo) -> Result<OrdemContrato, ErroStore> {
    let lado = match lado_do_banco(&linha.try_get::<String, _>("lado")?)? {
        Lado::Compra => LadoContrato::Compra,
        Lado::Venda => LadoContrato::Venda,
    };
    let status = match status_do_banco(&linha.try_get::<String, _>("status")?)? {
        Status::Aberta => StatusContrato::Aberta,
        Status::Parcial => StatusContrato::Parcial,
        Status::Executada => StatusContrato::Executada,
        Status::Cancelada => StatusContrato::Cancelada,
        Status::Rejeitada => StatusContrato::Rejeitada,
    };
    let motivo = linha
        .try_get::<Option<String>, _>("motivo_rejeicao")?
        .map(|m| {
            MotivoRejeicao::de_codigo(&m)
                .ok_or_else(|| inconsistente(format!("motivo_rejeicao desconhecido: {m}")))
        })
        .transpose()?;
    Ok(OrdemContrato {
        id: linha.try_get("id")?,
        client_order_id: linha.try_get("client_order_id")?,
        investidor_id: linha.try_get("investidor_id")?,
        ativo: catalogo.codigo(linha.try_get("ativo_id")?)?.to_owned(),
        lado,
        preco_limite: texto_dinheiro(linha.try_get("preco_limite")?),
        quantidade: nao_negativo(linha.try_get("quantidade")?)?,
        quantidade_executada: nao_negativo(linha.try_get("quantidade_executada")?)?,
        status,
        motivo_rejeicao: motivo,
    })
}

fn lado_banco(lado: Lado) -> &'static str {
    match lado {
        Lado::Compra => "compra",
        Lado::Venda => "venda",
    }
}

fn lado_do_banco(texto: &str) -> Result<Lado, ErroStore> {
    match texto {
        "compra" => Ok(Lado::Compra),
        "venda" => Ok(Lado::Venda),
        outro => Err(inconsistente(format!("lado desconhecido: {outro}"))),
    }
}

fn status_banco(status: Status) -> &'static str {
    match status {
        Status::Aberta => "ABERTA",
        Status::Parcial => "PARCIAL",
        Status::Executada => "EXECUTADA",
        Status::Cancelada => "CANCELADA",
        Status::Rejeitada => "REJEITADA",
    }
}

fn status_do_banco(texto: &str) -> Result<Status, ErroStore> {
    match texto {
        "ABERTA" => Ok(Status::Aberta),
        "PARCIAL" => Ok(Status::Parcial),
        "EXECUTADA" => Ok(Status::Executada),
        "CANCELADA" => Ok(Status::Cancelada),
        "REJEITADA" => Ok(Status::Rejeitada),
        outro => Err(inconsistente(format!("status desconhecido: {outro}"))),
    }
}

fn preco(valor: Decimal) -> Result<Preco, ErroStore> {
    Preco::novo(valor).map_err(|_| inconsistente(format!("preço inválido: {valor}")))
}

fn dinheiro(valor: Decimal) -> Result<Dinheiro, ErroStore> {
    Dinheiro::novo(valor).map_err(|_| inconsistente(format!("saldo inválido: {valor}")))
}

fn nao_negativo(valor: i32) -> Result<u32, ErroStore> {
    u32::try_from(valor).map_err(|_| inconsistente(format!("quantidade negativa: {valor}")))
}

fn quantidade_banco(valor: u32) -> Result<i32, ErroStore> {
    i32::try_from(valor).map_err(|_| inconsistente(format!("quantidade fora de integer: {valor}")))
}

fn inconsistente(motivo: String) -> ErroStore {
    ErroStore::Inconsistente(motivo)
}
