//! Configuração só por variável de ambiente, validada ao subir (regra 3.3.9).

/// Variável ausente ou inválida: o Motor não sobe.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
#[error("variável de ambiente {nome}: {motivo}")]
pub struct ErroConfig {
    pub nome: &'static str,
    pub motivo: &'static str,
}

/// O que o Motor precisa para rodar.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Config {
    pub database_url: String,
    pub redis_url: String,
    /// RF-024/SD-04: comando mais velho que isto é descartado com COMANDO_EXPIRADO.
    pub ordem_timeout_ms: u64,
    /// Nome deste consumidor no grupo `engine` do stream `orders`.
    pub consumidor: String,
    /// RF-026: porta HTTP do `GET /metrics` (padrão 9100).
    pub porta_metricas: u16,
}

impl Config {
    /// Lê do ambiente do processo.
    pub fn do_ambiente() -> Result<Self, ErroConfig> {
        Self::de(|nome| std::env::var(nome).ok())
    }

    /// Lê de uma função qualquer, para testar sem mexer no ambiente.
    pub fn de(ler: impl Fn(&str) -> Option<String>) -> Result<Self, ErroConfig> {
        let obrigatoria = |nome: &'static str| {
            ler(nome)
                .filter(|v| !v.trim().is_empty())
                .ok_or(ErroConfig {
                    nome,
                    motivo: "não definida",
                })
        };
        let database_url = obrigatoria("DATABASE_URL")?;
        if !database_url.starts_with("postgres://") && !database_url.starts_with("postgresql://") {
            return Err(ErroConfig {
                nome: "DATABASE_URL",
                motivo: "deve ser uma URL postgres://",
            });
        }
        let redis_url = obrigatoria("REDIS_URL")?;
        if !redis_url.starts_with("redis://") && !redis_url.starts_with("rediss://") {
            return Err(ErroConfig {
                nome: "REDIS_URL",
                motivo: "deve ser uma URL redis://",
            });
        }
        let ordem_timeout_ms = obrigatoria("ORDEM_TIMEOUT_MS")?
            .parse::<u64>()
            .ok()
            .filter(|v| *v > 0)
            .ok_or(ErroConfig {
                nome: "ORDEM_TIMEOUT_MS",
                motivo: "deve ser um inteiro maior que zero",
            })?;
        let consumidor = ler("ENGINE_CONSUMIDOR")
            .filter(|v| !v.trim().is_empty())
            .unwrap_or_else(|| "engine-1".to_owned());
        let porta_metricas = match ler("ENGINE_METRICS_PORT").filter(|v| !v.trim().is_empty()) {
            None => 9100,
            Some(valor) => valor
                .parse::<u16>()
                .ok()
                .filter(|p| *p > 0)
                .ok_or(ErroConfig {
                    nome: "ENGINE_METRICS_PORT",
                    motivo: "deve ser uma porta entre 1 e 65535",
                })?,
        };
        Ok(Self {
            database_url,
            redis_url,
            ordem_timeout_ms,
            consumidor,
            porta_metricas,
        })
    }
}

#[cfg(test)]
mod testes {
    use super::*;
    use std::collections::HashMap;

    fn ambiente(pares: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let mapa: HashMap<String, String> = pares
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect();
        move |nome| mapa.get(nome).cloned()
    }

    const VALIDO: [(&str, &str); 3] = [
        (
            "DATABASE_URL",
            "postgres://engine_app:x@localhost:5432/bolsa",
        ),
        ("REDIS_URL", "redis://localhost:6379"),
        ("ORDEM_TIMEOUT_MS", "3000"),
    ];

    #[test]
    fn le_o_ambiente_valido() {
        let config = Config::de(ambiente(&VALIDO));
        assert_eq!(
            config.map(|c| (c.ordem_timeout_ms, c.consumidor)),
            Ok((3000, "engine-1".to_owned()))
        );
    }

    #[test]
    fn recusa_variavel_faltando_ou_invalida() {
        for (nome, valor) in [
            ("DATABASE_URL", ""),
            ("DATABASE_URL", "mysql://x"),
            ("REDIS_URL", "http://x"),
            ("ORDEM_TIMEOUT_MS", "0"),
            ("ORDEM_TIMEOUT_MS", "3s"),
            ("ENGINE_METRICS_PORT", "abc"),
        ] {
            let mut pares = VALIDO.to_vec();
            pares.retain(|(k, _)| *k != nome);
            pares.push((nome, valor));
            let erro = Config::de(ambiente(&pares)).map(|_| ());
            assert_eq!(erro.map_err(|e| e.nome), Err(nome), "{nome}={valor}");
        }
    }
}
