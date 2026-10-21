//! RF-009/010/005: reservas e custo médio ponderado.
use super::resultado::Rejeicao;
use super::{Dinheiro, Lado, Ordem};
use rust_decimal::{Decimal, RoundingStrategy};
use std::collections::BTreeMap;
/// Posição com ações disponíveis e reservadas; custo médio em quatro casas.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Posicao {
    pub disponivel: u32,
    pub reservada: u32,
    pub preco_medio: Decimal,
}
/// Conta carregada pela casca; valores devem corresponder ao snapshot persistido.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Conta {
    pub disponivel: Dinheiro,
    pub reservado: Dinheiro,
    pub posicoes: BTreeMap<i32, Posicao>,
}
impl Conta {
    pub(crate) fn reservar(&mut self, ordem: &Ordem) -> Result<(), Rejeicao> {
        match ordem.lado {
            Lado::Compra => {
                let valor = ordem.preco.total(ordem.quantidade)?.valor();
                if self.disponivel.valor() < valor {
                    return Err(Rejeicao::SaldoInsuficiente);
                }
                let reservado = Dinheiro::novo(self.reservado.valor() + valor)?;
                self.disponivel = Dinheiro::novo(self.disponivel.valor() - valor)?;
                self.reservado = reservado;
            }
            Lado::Venda => {
                let pos = self
                    .posicoes
                    .get_mut(&ordem.ativo_id)
                    .ok_or(Rejeicao::AcoesInsuficientes)?;
                if pos.disponivel < ordem.restante() {
                    return Err(Rejeicao::AcoesInsuficientes);
                }
                pos.reservada = somar(pos.reservada, ordem.restante())?;
                pos.disponivel -= ordem.restante();
            }
        }
        Ok(())
    }
    pub(crate) fn liberar(&mut self, ordem: &Ordem) -> Result<(), Rejeicao> {
        match ordem.lado {
            Lado::Compra => {
                let valor = ordem.preco.valor() * Decimal::from(ordem.restante());
                self.reservado = Dinheiro::novo(self.reservado.valor() - valor)?;
                self.disponivel = Dinheiro::novo(self.disponivel.valor() + valor)?;
            }
            Lado::Venda => {
                let pos = self
                    .posicoes
                    .get_mut(&ordem.ativo_id)
                    .ok_or(Rejeicao::EstadoInvalido)?;
                pos.reservada = pos
                    .reservada
                    .checked_sub(ordem.restante())
                    .ok_or(Rejeicao::EstadoInvalido)?;
                pos.disponivel = somar(pos.disponivel, ordem.restante())?;
            }
        }
        Ok(())
    }
    pub(crate) fn comprar(
        &mut self,
        ordem: &Ordem,
        qtd: u32,
        preco: Decimal,
    ) -> Result<(), Rejeicao> {
        let reserva = ordem.preco.valor() * Decimal::from(qtd);
        let custo = preco * Decimal::from(qtd);
        self.reservado = Dinheiro::novo(self.reservado.valor() - reserva)?;
        self.disponivel = Dinheiro::novo(self.disponivel.valor() + reserva - custo)?;
        let pos = self.posicoes.entry(ordem.ativo_id).or_default();
        let anterior = somar(pos.disponivel, pos.reservada)?;
        let total = somar(anterior, qtd)?;
        pos.preco_medio = ((pos.preco_medio * Decimal::from(anterior) + custo)
            / Decimal::from(total))
        .round_dp_with_strategy(4, RoundingStrategy::MidpointAwayFromZero);
        pos.disponivel = somar(pos.disponivel, qtd)?;
        Ok(())
    }
    pub(crate) fn vender(
        &mut self,
        ordem: &Ordem,
        qtd: u32,
        preco: Decimal,
    ) -> Result<(), Rejeicao> {
        self.disponivel = Dinheiro::novo(self.disponivel.valor() + preco * Decimal::from(qtd))?;
        let pos = self
            .posicoes
            .get_mut(&ordem.ativo_id)
            .ok_or(Rejeicao::EstadoInvalido)?;
        pos.reservada = pos
            .reservada
            .checked_sub(qtd)
            .ok_or(Rejeicao::EstadoInvalido)?;
        if pos.disponivel == 0 && pos.reservada == 0 {
            pos.preco_medio = Decimal::ZERO;
        }
        Ok(())
    }
}
fn somar(a: u32, b: u32) -> Result<u32, Rejeicao> {
    a.checked_add(b)
        .filter(|v| *v <= i32::MAX as u32)
        .ok_or(Rejeicao::ValorInvalido)
}
