//! Structs serde que espelham `packages/contracts/schemas/comando-ordem.json` e
//! `resultado-ordem.json` (regra 3.3.8: mudam no mesmo PR que o schema).
//!
//! Dinheiro trafega como string decimal e continua `String` aqui, para que a ida e volta
//! seja exata (T-14). A conversão para `Decimal` passa por [`decimal`], que recusa o que
//! o schema recusa.

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::str::FromStr;

/// Estágios do RF-025, com a mesma grafia de `packages/contracts/src/stage.ts`.
pub mod stage {
    pub const ORDER_RECEIVED: &str = "ORDER_RECEIVED";
    pub const ORDER_VALIDATED: &str = "ORDER_VALIDATED";
    pub const ORDER_BOOK_INSERTED: &str = "ORDER_BOOK_INSERTED";
    pub const MATCH_FOUND: &str = "MATCH_FOUND";
    pub const TRADE_EXECUTED: &str = "TRADE_EXECUTED";
    pub const PORTFOLIO_UPDATED: &str = "PORTFOLIO_UPDATED";
    pub const CLIENTS_NOTIFIED: &str = "CLIENTS_NOTIFIED";
    pub const ORDER_REJECTED: &str = "ORDER_REJECTED";
}

/// Por que uma mensagem não segue o contrato. Serde cobre forma e tipos; isto cobre os
/// `pattern`, `minimum` e o `if/then` dos schemas.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ErroContrato {
    #[error("JSON fora do contrato: {0}")]
    Formato(String),
    #[error("campo {campo} inválido: {motivo}")]
    Campo {
        campo: &'static str,
        motivo: &'static str,
    },
}

/// Lado da ordem no contrato (`COMPRA`/`VENDA`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LadoContrato {
    Compra,
    Venda,
}

/// Status da ordem no contrato (RF-011).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum StatusContrato {
    Aberta,
    Parcial,
    Executada,
    Cancelada,
    Rejeitada,
}

/// Motivos de rejeição do contrato (arquitetura §4.2).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MotivoRejeicao {
    SaldoInsuficiente,
    AcoesInsuficientes,
    AtivoInexistente,
    OrdemNaoEncontrada,
    OrdemDeOutroInvestidor,
    OrdemNaoCancelavel,
    ComandoExpirado,
}

impl MotivoRejeicao {
    /// Texto gravado em `ordens.motivo_rejeicao`: o mesmo do JSON.
    pub fn codigo(self) -> &'static str {
        match self {
            Self::SaldoInsuficiente => "SALDO_INSUFICIENTE",
            Self::AcoesInsuficientes => "ACOES_INSUFICIENTES",
            Self::AtivoInexistente => "ATIVO_INEXISTENTE",
            Self::OrdemNaoEncontrada => "ORDEM_NAO_ENCONTRADA",
            Self::OrdemDeOutroInvestidor => "ORDEM_DE_OUTRO_INVESTIDOR",
            Self::OrdemNaoCancelavel => "ORDEM_NAO_CANCELAVEL",
            Self::ComandoExpirado => "COMANDO_EXPIRADO",
        }
    }

    /// Inverso de [`MotivoRejeicao::codigo`], para ler ordens rejeitadas do banco.
    pub fn de_codigo(codigo: &str) -> Option<Self> {
        serde_json::from_value(serde_json::Value::String(codigo.to_owned())).ok()
    }
}

/// Comando do stream `orders`, campo `payload` (plano §3.1).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "tipo", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum ComandoOrdem {
    #[serde(rename_all = "camelCase")]
    Criar {
        client_order_id: String,
        investidor_id: i32,
        ativo: String,
        lado: LadoContrato,
        quantidade: u32,
        preco: String,
    },
    #[serde(rename_all = "camelCase")]
    Cancelar {
        client_order_id: String,
        investidor_id: i32,
        ordem_id: i64,
    },
}

impl ComandoOrdem {
    /// Lê e valida o `payload` de uma entrada do stream.
    pub fn de_json(texto: &str) -> Result<Self, ErroContrato> {
        let comando: Self =
            serde_json::from_str(texto).map_err(|e| ErroContrato::Formato(e.to_string()))?;
        comando.validar()?;
        Ok(comando)
    }

    /// Regras do schema que o serde não expressa.
    pub fn validar(&self) -> Result<(), ErroContrato> {
        match self {
            Self::Criar {
                client_order_id,
                investidor_id,
                ativo,
                quantidade,
                preco,
                ..
            } => {
                validar_uuid(client_order_id)?;
                validar_investidor(*investidor_id)?;
                if !codigo_de_ativo_valido(ativo) {
                    return Err(campo("ativo", "deve ser um código como ABC3"));
                }
                if *quantidade == 0 || *quantidade > i32::MAX as u32 {
                    return Err(campo("quantidade", "deve estar entre 1 e 2147483647"));
                }
                let valor = decimal(preco).ok_or(campo("preco", "decimal com até 2 casas"))?;
                if valor <= Decimal::ZERO || valor >= Decimal::from(10_000_000_000_000_i64) {
                    return Err(campo(
                        "preco",
                        "deve ser maior que zero e caber em decimal(15,2)",
                    ));
                }
                Ok(())
            }
            Self::Cancelar {
                client_order_id,
                investidor_id,
                ordem_id,
            } => {
                validar_uuid(client_order_id)?;
                validar_investidor(*investidor_id)?;
                if *ordem_id < 1 {
                    return Err(campo("ordemId", "deve ser maior que zero"));
                }
                Ok(())
            }
        }
    }

    /// Identificação para idempotência e correlação: `(investidorId, clientOrderId)`.
    pub fn chave(&self) -> (i32, &str) {
        match self {
            Self::Criar {
                investidor_id,
                client_order_id,
                ..
            }
            | Self::Cancelar {
                investidor_id,
                client_order_id,
                ..
            } => (*investidor_id, client_order_id),
        }
    }
}

/// Ordem como sai no resultado (igual a `OrdemResposta` do api-rest).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OrdemContrato {
    pub id: i64,
    pub client_order_id: String,
    pub investidor_id: i32,
    pub ativo: String,
    pub lado: LadoContrato,
    pub preco_limite: String,
    pub quantidade: u32,
    pub quantidade_executada: u32,
    pub status: StatusContrato,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub motivo_rejeicao: Option<MotivoRejeicao>,
}

/// Negócio executado (igual a `dados` do evento `NEGOCIO`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NegocioContrato {
    pub id: i64,
    pub ativo: String,
    pub preco: String,
    pub quantidade: u32,
    pub momento: String,
}

/// Estado de um ativo depois do comando (igual a `dados` do evento `PRECO`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MercadoContrato {
    pub ativo: String,
    pub preco_atual: String,
    pub variacao: String,
    pub volume: i64,
}

/// Publicado em `ordens.resultado` depois do COMMIT de cada comando.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResultadoOrdem {
    pub client_order_id: String,
    pub investidor_id: i32,
    // Sem `default`: o campo é obrigatório no schema, mesmo quando vale null
    #[serde(deserialize_with = "obrigatorio_nulo")]
    pub ordem: Option<OrdemContrato>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub motivo_rejeicao: Option<MotivoRejeicao>,
    pub ordens_atualizadas: Vec<OrdemContrato>,
    pub negocios: Vec<NegocioContrato>,
    pub mercado: Vec<MercadoContrato>,
}

impl ResultadoOrdem {
    /// Lê e valida um resultado (usado pelo T-14).
    pub fn de_json(texto: &str) -> Result<Self, ErroContrato> {
        let resultado: Self =
            serde_json::from_str(texto).map_err(|e| ErroContrato::Formato(e.to_string()))?;
        resultado.validar()?;
        Ok(resultado)
    }

    /// Regras do schema que o serde não expressa.
    pub fn validar(&self) -> Result<(), ErroContrato> {
        validar_uuid(&self.client_order_id)?;
        validar_investidor(self.investidor_id)?;
        if self.ordem.is_none() && self.motivo_rejeicao.is_none() {
            return Err(campo("motivoRejeicao", "obrigatório quando ordem é null"));
        }
        for ordem in self.ordem.iter().chain(&self.ordens_atualizadas) {
            validar_ordem(ordem)?;
        }
        for negocio in &self.negocios {
            if negocio.id < 1 || negocio.quantidade == 0 {
                return Err(campo(
                    "negocios",
                    "id e quantidade devem ser maiores que zero",
                ));
            }
            decimal(&negocio.preco).ok_or(campo("negocios.preco", "decimal com até 2 casas"))?;
        }
        for mercado in &self.mercado {
            decimal(&mercado.preco_atual)
                .ok_or(campo("mercado.precoAtual", "decimal com até 2 casas"))?;
            percentual(&mercado.variacao)
                .ok_or(campo("mercado.variacao", "percentual com até 2 casas"))?;
            if mercado.volume < 0 {
                return Err(campo("mercado.volume", "não pode ser negativo"));
            }
        }
        Ok(())
    }
}

/// Converte uma string do contrato (`^[0-9]+(\.[0-9]{1,2})?$`) em `Decimal`, sem
/// arredondar. Devolve `None` para sinal, expoente, espaços ou mais de 2 casas.
pub fn decimal(texto: &str) -> Option<Decimal> {
    let (inteiro, casas) = texto.split_once('.').unwrap_or((texto, ""));
    let digitos = |s: &str| s.bytes().all(|b| b.is_ascii_digit());
    let formato_ok = !inteiro.is_empty()
        && digitos(inteiro)
        && digitos(casas)
        && (texto.contains('.') == !casas.is_empty())
        && casas.len() <= 2;
    if !formato_ok {
        return None;
    }
    Decimal::from_str(texto).ok()
}

/// Formata dinheiro para o contrato, sempre com 2 casas (`"25.50"`).
pub fn texto_dinheiro(valor: Decimal) -> String {
    format!("{:.2}", valor)
}

fn percentual(texto: &str) -> Option<Decimal> {
    decimal(texto.strip_prefix('-').unwrap_or(texto))
}

fn validar_ordem(ordem: &OrdemContrato) -> Result<(), ErroContrato> {
    validar_uuid(&ordem.client_order_id)?;
    validar_investidor(ordem.investidor_id)?;
    if ordem.id < 1 || ordem.quantidade == 0 || ordem.quantidade_executada > ordem.quantidade {
        return Err(campo(
            "ordem",
            "id, quantidade ou quantidadeExecutada incoerentes",
        ));
    }
    decimal(&ordem.preco_limite).ok_or(campo("ordem.precoLimite", "decimal com até 2 casas"))?;
    Ok(())
}

fn validar_uuid(texto: &str) -> Result<(), ErroContrato> {
    let bytes = texto.as_bytes();
    let ok = bytes.len() == 36
        && bytes.iter().enumerate().all(|(i, b)| match i {
            8 | 13 | 18 | 23 => *b == b'-',
            _ => b.is_ascii_hexdigit(),
        });
    if ok {
        Ok(())
    } else {
        Err(campo("clientOrderId", "deve ser um UUID"))
    }
}

fn validar_investidor(id: i32) -> Result<(), ErroContrato> {
    if id < 1 {
        return Err(campo("investidorId", "deve ser maior que zero"));
    }
    Ok(())
}

/// `^[A-Z]{3,4}[0-9]{1,2}$`, igual ao DTO do Gateway.
fn codigo_de_ativo_valido(codigo: &str) -> bool {
    let letras = codigo.bytes().take_while(u8::is_ascii_uppercase).count();
    let digitos = codigo.len() - letras;
    (3..=4).contains(&letras)
        && (1..=2).contains(&digitos)
        && codigo.bytes().skip(letras).all(|b| b.is_ascii_digit())
}

fn campo(campo: &'static str, motivo: &'static str) -> ErroContrato {
    ErroContrato::Campo { campo, motivo }
}

fn obrigatorio_nulo<'de, D, T>(d: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(d)
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn decimal_aceita_so_o_formato_do_contrato() {
        assert_eq!(decimal("25.50"), Some(Decimal::new(2550, 2)));
        assert_eq!(decimal("7"), Some(Decimal::from(7)));
        for invalido in ["", "-1", "1.", ".5", "1.234", "1e3", " 1", "1,00", "+1"] {
            assert_eq!(decimal(invalido), None, "{invalido}");
        }
    }

    #[test]
    fn texto_dinheiro_sempre_com_duas_casas() {
        assert_eq!(texto_dinheiro(Decimal::from(102)), "102.00");
        assert_eq!(texto_dinheiro(Decimal::new(255, 1)), "25.50");
    }

    #[test]
    fn codigo_de_ativo() {
        for valido in ["ABC3", "PETR4", "ABCD11"] {
            assert!(codigo_de_ativo_valido(valido), "{valido}");
        }
        for invalido in ["AB3", "abc3", "ABC", "ABCDE3", "ABC123", "AB3C"] {
            assert!(!codigo_de_ativo_valido(invalido), "{invalido}");
        }
    }

    #[test]
    fn motivo_ida_e_volta_pelo_codigo() {
        let motivo = MotivoRejeicao::OrdemNaoCancelavel;
        assert_eq!(MotivoRejeicao::de_codigo(motivo.codigo()), Some(motivo));
        assert_eq!(MotivoRejeicao::de_codigo("OUTRO"), None);
    }
}
