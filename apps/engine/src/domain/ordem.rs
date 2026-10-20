//! Ordens sem timestamps: o ID do servidor determina a prioridade.
use super::{Preco, Quantidade};
/// Direção da ordem limitada.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Lado {
    Compra,
    Venda,
}
/// Ciclo de vida da ordem (RF-011).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Aberta,
    Parcial,
    Executada,
    Cancelada,
    Rejeitada,
}
/// Ordem validada; os IDs são fornecidos pela casca.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Ordem {
    pub id: i64,
    pub investidor_id: i32,
    pub ativo_id: i32,
    pub lado: Lado,
    pub preco: Preco,
    pub quantidade: Quantidade,
    pub(crate) executada: u32,
    pub(crate) status: Status,
}
impl Ordem {
    /// Cria uma ordem ainda sem execuções.
    pub fn nova(
        id: i64,
        investidor_id: i32,
        ativo_id: i32,
        lado: Lado,
        preco: Preco,
        quantidade: Quantidade,
    ) -> Self {
        Self {
            id,
            investidor_id,
            ativo_id,
            lado,
            preco,
            quantidade,
            executada: 0,
            status: Status::Aberta,
        }
    }
    /// Reconstrói ordem persistida, validando coerência entre execução e status.
    pub fn restaurar(
        mut ordem: Self,
        executada: u32,
        status: Status,
    ) -> Result<Self, super::Rejeicao> {
        let total = ordem.quantidade.valor();
        let valido = match status {
            Status::Aberta | Status::Rejeitada => executada == 0,
            Status::Parcial => executada > 0 && executada < total,
            Status::Executada => executada == total,
            Status::Cancelada => executada < total,
        };
        if !valido {
            return Err(super::Rejeicao::EstadoInvalido);
        }
        ordem.executada = executada;
        ordem.status = status;
        Ok(ordem)
    }
    /// Quantidade ainda não executada, inclusive após cancelamento.
    pub fn restante(&self) -> u32 {
        self.quantidade.valor() - self.executada
    }
    /// Quantidade efetivamente negociada.
    pub fn executada(&self) -> u32 {
        self.executada
    }
    /// Estado atual da ordem.
    pub fn status(&self) -> Status {
        self.status
    }
    pub(crate) fn executar(&mut self, qtd: u32) {
        self.executada += qtd;
        self.status = if self.restante() == 0 {
            Status::Executada
        } else {
            Status::Parcial
        };
    }
}
