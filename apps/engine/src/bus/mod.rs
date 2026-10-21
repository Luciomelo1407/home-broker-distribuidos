//! Redis do lado do Motor (docs/integracao.md §1): consumidor do stream `orders` no
//! grupo `engine`, publicação em `ordens.resultado` e batimento em `motor:heartbeat`.

use crate::contract::ResultadoOrdem;
use redis::AsyncCommands;
use redis::aio::MultiplexedConnection;
use redis::streams::{StreamReadOptions, StreamReadReply};
use std::time::Duration;

pub const STREAM_ORDENS: &str = "orders";
pub const GRUPO: &str = "engine";
pub const CANAL_RESULTADO: &str = "ordens.resultado";
pub const CHAVE_HEARTBEAT: &str = "motor:heartbeat";
/// O batimento expira sozinho se o Motor parar de renová-lo (RF-024, demo CA-05).
pub const HEARTBEAT_TTL_S: u64 = 5;

/// Falha de conexão ou de comando no Redis. O Motor encerra e o Docker o reinicia.
#[derive(Debug, thiserror::Error)]
#[error("Redis: {0}")]
pub struct ErroBus(#[from] redis::RedisError);

/// Uma entrada do stream: o ID e o campo `payload`, se existir.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EntradaStream {
    pub id: String,
    pub payload: Option<String>,
}

/// Leitura com confirmação (XREADGROUP + XACK). Usa uma conexão só para ele, porque o
/// `BLOCK` prende a conexão enquanto espera.
pub struct Consumidor {
    conexao: MultiplexedConnection,
    nome: String,
}

impl Consumidor {
    /// Conecta e cria o grupo `engine` se ainda não existir (começando do início do stream).
    pub async fn conectar(cliente: &redis::Client, nome: &str) -> Result<Self, ErroBus> {
        // O BLOCK do XREADGROUP passa do timeout de resposta padrão; o limite aqui é
        // a espera pedida mais uma folga
        let config =
            redis::AsyncConnectionConfig::new().set_response_timeout(Some(Duration::from_secs(10)));
        let mut conexao = cliente
            .get_multiplexed_async_connection_with_config(&config)
            .await?;
        let criado: Result<(), redis::RedisError> = conexao
            .xgroup_create_mkstream(STREAM_ORDENS, GRUPO, "0")
            .await;
        match criado {
            Ok(()) => {}
            Err(erro) if erro.code() == Some("BUSYGROUP") => {}
            Err(erro) => return Err(erro.into()),
        }
        Ok(Self {
            conexao,
            nome: nome.to_owned(),
        })
    }

    /// Entradas entregues a este consumidor e ainda sem XACK (o Motor caiu antes de
    /// confirmar). São reprocessadas primeiro; a idempotência evita duplicar (T-08).
    pub async fn pendentes(&mut self) -> Result<Vec<EntradaStream>, ErroBus> {
        self.ler("0", None).await
    }

    /// Próximas entradas novas, esperando até `bloquear_ms` se não houver nenhuma.
    pub async fn proximas(&mut self, bloquear_ms: usize) -> Result<Vec<EntradaStream>, ErroBus> {
        self.ler(">", Some(bloquear_ms)).await
    }

    /// RF-024: confirma só depois do COMMIT e da publicação.
    pub async fn confirmar(&mut self, id: &str) -> Result<(), ErroBus> {
        let _: usize = self.conexao.xack(STREAM_ORDENS, GRUPO, &[id]).await?;
        Ok(())
    }

    async fn ler(
        &mut self,
        a_partir: &str,
        bloquear_ms: Option<usize>,
    ) -> Result<Vec<EntradaStream>, ErroBus> {
        let mut opcoes = StreamReadOptions::default()
            .group(GRUPO, &self.nome)
            .count(10);
        if let Some(ms) = bloquear_ms {
            opcoes = opcoes.block(ms);
        }
        let resposta: Option<StreamReadReply> = self
            .conexao
            .xread_options(&[STREAM_ORDENS], &[a_partir], &opcoes)
            .await?;
        Ok(resposta
            .into_iter()
            .flat_map(|r| r.keys)
            .flat_map(|chave| chave.ids)
            .map(|entrada| EntradaStream {
                payload: entrada.get::<String>("payload"),
                id: entrada.id,
            })
            .collect())
    }
}

/// Publicação de resultados e batimento.
#[derive(Clone)]
pub struct Publicador {
    conexao: MultiplexedConnection,
}

impl Publicador {
    pub async fn conectar(cliente: &redis::Client) -> Result<Self, ErroBus> {
        Ok(Self {
            conexao: cliente.get_multiplexed_async_connection().await?,
        })
    }

    /// RF-018: entrega o resultado a todos os Gateways inscritos.
    pub async fn publicar(&mut self, resultado: &ResultadoOrdem) -> Result<(), ErroBus> {
        let texto = serde_json::to_string(resultado).map_err(|e| {
            redis::RedisError::from((
                redis::ErrorKind::Client,
                "resultado não serializa",
                e.to_string(),
            ))
        })?;
        let _: usize = self.conexao.publish(CANAL_RESULTADO, texto).await?;
        Ok(())
    }

    /// RF-026: entradas do stream que o grupo `engine` ainda não leu (`lag` do XINFO GROUPS,
    /// Redis 7+). `None` se o grupo não existir ou o Redis não informar.
    pub async fn fila_pendente(&mut self) -> Result<Option<u64>, ErroBus> {
        let grupos: Vec<std::collections::HashMap<String, redis::Value>> = redis::cmd("XINFO")
            .arg("GROUPS")
            .arg(STREAM_ORDENS)
            .query_async(&mut self.conexao)
            .await?;
        Ok(grupos
            .iter()
            .find(|g| {
                g.get("name")
                    .and_then(|v| redis::from_redis_value_ref::<String>(v).ok())
                    .is_some_and(|nome| nome == GRUPO)
            })
            .and_then(|g| g.get("lag"))
            .and_then(|v| redis::from_redis_value_ref::<u64>(v).ok()))
    }

    /// Renova `motor:heartbeat` com o horário atual (ms).
    pub async fn bater(&mut self, agora_ms: u64) -> Result<(), ErroBus> {
        let _: () = self
            .conexao
            .set_ex(CHAVE_HEARTBEAT, agora_ms, HEARTBEAT_TTL_S)
            .await?;
        Ok(())
    }
}
