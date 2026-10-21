//! Métricas do Motor (RF-026), no formato texto do Prometheus, com os nomes da arquitetura
//! §4.3 (os mesmos do Gateway; o rótulo `job` do Prometheus diferencia os dois). Sem
//! dependências: contadores em atômicos e um HTTP mínimo que só responde `GET /metrics`.

use std::fmt::Write as _;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tracing::warn;

/// Limites (em segundos) do histograma de latência por comando.
const LIMITES: [f64; 10] = [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0];

/// Como um comando terminou no Motor.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ResultadoComando {
    /// Gravado e aplicado (ordem aceita, executada ou cancelada).
    Aceito,
    /// Recusado por regra (saldo, ações, cancelamento inválido, vencido).
    Rejeitado,
    /// Fora do contrato ou de investidor inexistente: descartado sem resultado.
    Descartado,
}

/// Métricas do processo, compartilhadas entre o laço principal e o servidor HTTP.
#[derive(Default)]
pub struct Metricas {
    aceitos: AtomicU64,
    rejeitados: AtomicU64,
    descartados: AtomicU64,
    negocios: AtomicU64,
    /// Contagem cumulativa por limite do histograma, mais o +Inf no fim.
    baldes: [AtomicU64; LIMITES.len() + 1],
    soma_micros: AtomicU64,
    fila_pendente: AtomicU64,
    erros_redis: AtomicU64,
}

impl Metricas {
    /// RF-026: um comando processado e quanto ele levou (domínio + COMMIT + PUBLISH + XACK).
    pub fn comando(&self, resultado: ResultadoComando, duracao: Duration, negocios: usize) {
        let contador = match resultado {
            ResultadoComando::Aceito => &self.aceitos,
            ResultadoComando::Rejeitado => &self.rejeitados,
            ResultadoComando::Descartado => &self.descartados,
        };
        contador.fetch_add(1, Ordering::Relaxed);
        self.negocios.fetch_add(
            u64::try_from(negocios).unwrap_or(u64::MAX),
            Ordering::Relaxed,
        );
        let segundos = duracao.as_secs_f64();
        for (limite, balde) in LIMITES.iter().zip(&self.baldes) {
            if segundos <= *limite {
                balde.fetch_add(1, Ordering::Relaxed);
            }
        }
        if let Some(infinito) = self.baldes.last() {
            infinito.fetch_add(1, Ordering::Relaxed);
        }
        self.soma_micros.fetch_add(
            u64::try_from(duracao.as_micros()).unwrap_or(u64::MAX),
            Ordering::Relaxed,
        );
    }

    /// Entradas do stream ainda não lidas pelo grupo `engine` (o `lag` do XINFO GROUPS).
    pub fn fila_pendente(&self, entradas: u64) {
        self.fila_pendente.store(entradas, Ordering::Relaxed);
    }

    pub fn erro_redis(&self) {
        self.erros_redis.fetch_add(1, Ordering::Relaxed);
    }

    /// Texto no formato de exposição do Prometheus.
    pub fn expor(&self) -> String {
        let ler = |a: &AtomicU64| a.load(Ordering::Relaxed);
        let mut t = String::new();
        let _ = writeln!(
            t,
            "# HELP bolsa_ordens_processadas_total Comandos processados pelo Motor, por resultado"
        );
        let _ = writeln!(t, "# TYPE bolsa_ordens_processadas_total counter");
        for (rotulo, valor) in [
            ("aceita", &self.aceitos),
            ("rejeitada", &self.rejeitados),
            ("descartada", &self.descartados),
        ] {
            let _ = writeln!(
                t,
                "bolsa_ordens_processadas_total{{resultado=\"{rotulo}\"}} {}",
                ler(valor)
            );
        }
        let _ = writeln!(
            t,
            "# HELP bolsa_ordem_latencia_segundos Tempo do Motor por comando, do domínio ao XACK"
        );
        let _ = writeln!(t, "# TYPE bolsa_ordem_latencia_segundos histogram");
        for (limite, balde) in LIMITES.iter().zip(&self.baldes) {
            let _ = writeln!(
                t,
                "bolsa_ordem_latencia_segundos_bucket{{le=\"{limite}\"}} {}",
                ler(balde)
            );
        }
        let total = self.baldes.last().map_or(0, ler);
        let _ = writeln!(
            t,
            "bolsa_ordem_latencia_segundos_bucket{{le=\"+Inf\"}} {total}"
        );
        let soma = ler(&self.soma_micros) as f64 / 1_000_000.0;
        let _ = writeln!(t, "bolsa_ordem_latencia_segundos_sum {soma}");
        let _ = writeln!(t, "bolsa_ordem_latencia_segundos_count {total}");
        let _ = writeln!(
            t,
            "# HELP bolsa_negocios_total Negócios executados (RF-015)"
        );
        let _ = writeln!(t, "# TYPE bolsa_negocios_total counter");
        let _ = writeln!(t, "bolsa_negocios_total {}", ler(&self.negocios));
        let _ = writeln!(
            t,
            "# HELP bolsa_fila_pendente Comandos no stream orders ainda não lidos pelo Motor"
        );
        let _ = writeln!(t, "# TYPE bolsa_fila_pendente gauge");
        let _ = writeln!(t, "bolsa_fila_pendente {}", ler(&self.fila_pendente));
        let _ = writeln!(t, "# HELP bolsa_erros_total Erros do Motor, por tipo");
        let _ = writeln!(t, "# TYPE bolsa_erros_total counter");
        let _ = writeln!(
            t,
            "bolsa_erros_total{{tipo=\"redis\"}} {}",
            ler(&self.erros_redis)
        );
        t
    }
}

/// Serve `GET /metrics` na porta dada. Qualquer outro caminho recebe 404.
pub async fn servir(metricas: Arc<Metricas>, porta: u16) -> std::io::Result<()> {
    let ouvinte = TcpListener::bind(("0.0.0.0", porta)).await?;
    loop {
        let (mut conexao, _) = ouvinte.accept().await?;
        let metricas = Arc::clone(&metricas);
        tokio::spawn(async move {
            let mut pedido = [0u8; 1024];
            let lidos = match conexao.read(&mut pedido).await {
                Ok(n) => n,
                Err(erro) => {
                    warn!(erro = %erro, "falha ao ler pedido de métricas");
                    return;
                }
            };
            let linha = String::from_utf8_lossy(&pedido[..lidos]);
            let resposta = if linha.starts_with("GET /metrics ")
                || linha.starts_with("GET /metrics?")
            {
                let corpo = metricas.expor();
                format!(
                    "HTTP/1.1 200 OK\r\ncontent-type: text/plain; version=0.0.4; charset=utf-8\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{corpo}",
                    corpo.len()
                )
            } else {
                "HTTP/1.1 404 Not Found\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"
                    .to_owned()
            };
            let _ = conexao.write_all(resposta.as_bytes()).await;
        });
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn conta_por_resultado_e_monta_o_histograma() {
        let m = Metricas::default();

        m.comando(ResultadoComando::Aceito, Duration::from_millis(2), 1);
        m.comando(ResultadoComando::Aceito, Duration::from_millis(30), 0);
        m.comando(ResultadoComando::Rejeitado, Duration::from_secs(2), 0);
        m.fila_pendente(7);
        let texto = m.expor();

        assert!(texto.contains("bolsa_ordens_processadas_total{resultado=\"aceita\"} 2"));
        assert!(texto.contains("bolsa_ordens_processadas_total{resultado=\"rejeitada\"} 1"));
        // 2 ms cai no balde de 0,0025; 30 ms no de 0,05; 2 s só no +Inf
        assert!(texto.contains("bolsa_ordem_latencia_segundos_bucket{le=\"0.0025\"} 1"));
        assert!(texto.contains("bolsa_ordem_latencia_segundos_bucket{le=\"0.05\"} 2"));
        assert!(texto.contains("bolsa_ordem_latencia_segundos_bucket{le=\"1\"} 2"));
        assert!(texto.contains("bolsa_ordem_latencia_segundos_bucket{le=\"+Inf\"} 3"));
        assert!(texto.contains("bolsa_ordem_latencia_segundos_count 3"));
        assert!(texto.contains("bolsa_negocios_total 1"));
        assert!(texto.contains("bolsa_fila_pendente 7"));
    }
}
