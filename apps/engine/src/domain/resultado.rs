//! Proposta de estado: persistir antes de substituir o estado em memória (RF-016).
use super::casamento::{Execucao, casar};
use super::{Conta, Livro, Ordem, Preco, Status};
use rust_decimal::Decimal;
use std::collections::BTreeMap;
/// Rejeições de negócio e entradas/estados inválidos; a casca traduz para o contrato.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Rejeicao {
    ValorInvalido,
    EstadoInvalido,
    SaldoInsuficiente,
    AcoesInsuficientes,
    AtivoInexistente,
    OrdemNaoEncontrada,
    OrdemDeOutroInvestidor,
    OrdemNaoCancelavel,
}
/// Indicadores do ativo; volume em número de ações negociadas.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Mercado {
    pub referencia: Preco,
    pub ultimo: Preco,
    pub volume: i64,
}
impl Mercado {
    /// Variação percentual em relação ao preço de referência (RF-017).
    pub fn variacao(&self) -> Decimal {
        (self.ultimo.valor() - self.referencia.valor()) / self.referencia.valor()
            * Decimal::from(100)
    }
}
/// Snapshot necessário ao processamento; nenhum acesso a banco ou rede.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Estado {
    pub contas: BTreeMap<i32, Conta>,
    pub ordens: BTreeMap<i64, Ordem>,
    pub livros: BTreeMap<i32, Livro>,
    pub mercados: BTreeMap<i32, Mercado>,
}
/// Proposta descartável: se o commit falhar, o Estado original continua intacto.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Resultado {
    pub estado: Estado,
    pub execucoes: Vec<Execucao>,
    pub ordens_alteradas: Vec<i64>,
}
impl Estado {
    /// RF-009 a RF-017: reserva, casa e liquida numa cópia, retornando proposta.
    pub fn criar(&self, ordem: Ordem) -> Result<Resultado, Rejeicao> {
        if !self.mercados.contains_key(&ordem.ativo_id) {
            return Err(Rejeicao::AtivoInexistente);
        }
        if self.ordens.contains_key(&ordem.id)
            || ordem.status() != Status::Aberta
            || ordem.executada() != 0
        {
            return Err(Rejeicao::EstadoInvalido);
        }
        let mut estado = self.clone();
        estado
            .contas
            .get_mut(&ordem.investidor_id)
            .ok_or(Rejeicao::EstadoInvalido)?
            .reservar(&ordem)?;
        let execucoes = estado
            .livros
            .get(&ordem.ativo_id)
            .map(|l| casar(l, &ordem))
            .unwrap_or_default();
        estado.ordens.insert(ordem.id, ordem.clone());
        let mut alteradas = vec![ordem.id];
        for exec in &execucoes {
            let compra = estado
                .ordens
                .get(&exec.compra_id)
                .ok_or(Rejeicao::EstadoInvalido)?
                .clone();
            let venda = estado
                .ordens
                .get(&exec.venda_id)
                .ok_or(Rejeicao::EstadoInvalido)?
                .clone();
            // RF-016: chamadas sequenciais também preservam autonegociações.
            estado
                .contas
                .get_mut(&compra.investidor_id)
                .ok_or(Rejeicao::EstadoInvalido)?
                .comprar(&compra, exec.quantidade, exec.preco.valor())?;
            estado
                .contas
                .get_mut(&venda.investidor_id)
                .ok_or(Rejeicao::EstadoInvalido)?
                .vender(&venda, exec.quantidade, exec.preco.valor())?;
            for id in [exec.compra_id, exec.venda_id] {
                let atualizada = estado.ordens.get_mut(&id).ok_or(Rejeicao::EstadoInvalido)?;
                atualizada.executar(exec.quantidade);
                if id != ordem.id {
                    let livro = estado
                        .livros
                        .get_mut(&ordem.ativo_id)
                        .ok_or(Rejeicao::EstadoInvalido)?;
                    livro.remover(id).ok_or(Rejeicao::EstadoInvalido)?;
                    if atualizada.restante() > 0 {
                        livro.inserir(atualizada.clone())?;
                    }
                }
                if !alteradas.contains(&id) {
                    alteradas.push(id);
                }
            }
            let mercado = estado
                .mercados
                .get_mut(&ordem.ativo_id)
                .ok_or(Rejeicao::EstadoInvalido)?;
            mercado.ultimo = exec.preco;
            mercado.volume = mercado
                .volume
                .checked_add(i64::from(exec.quantidade))
                .ok_or(Rejeicao::ValorInvalido)?;
        }
        let atual = estado
            .ordens
            .get(&ordem.id)
            .ok_or(Rejeicao::EstadoInvalido)?;
        if atual.restante() > 0 {
            estado
                .livros
                .entry(ordem.ativo_id)
                .or_default()
                .inserir(atual.clone())?;
        }
        Ok(Resultado {
            estado,
            execucoes,
            ordens_alteradas: alteradas,
        })
    }
    /// RF-012/RNF-08: cancela apenas o restante da própria ordem e libera reservas.
    pub fn cancelar(&self, investidor_id: i32, ordem_id: i64) -> Result<Resultado, Rejeicao> {
        let ordem = self
            .ordens
            .get(&ordem_id)
            .ok_or(Rejeicao::OrdemNaoEncontrada)?;
        if ordem.investidor_id != investidor_id {
            return Err(Rejeicao::OrdemDeOutroInvestidor);
        }
        if !matches!(ordem.status(), Status::Aberta | Status::Parcial) {
            return Err(Rejeicao::OrdemNaoCancelavel);
        }
        let mut estado = self.clone();
        estado
            .contas
            .get_mut(&investidor_id)
            .ok_or(Rejeicao::EstadoInvalido)?
            .liberar(ordem)?;
        estado
            .livros
            .get_mut(&ordem.ativo_id)
            .ok_or(Rejeicao::EstadoInvalido)?
            .remover(ordem_id)
            .ok_or(Rejeicao::EstadoInvalido)?;
        estado
            .ordens
            .get_mut(&ordem_id)
            .ok_or(Rejeicao::EstadoInvalido)?
            .status = Status::Cancelada;
        Ok(Resultado {
            estado,
            execucoes: vec![],
            ordens_alteradas: vec![ordem_id],
        })
    }
}
