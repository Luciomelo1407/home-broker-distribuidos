//! RF-013: níveis ordenados e fila ordenada por ID, inclusive na recuperação.
use super::resultado::Rejeicao;
use super::{Lado, Ordem, Preco, Status};
use std::collections::{BTreeMap, VecDeque};
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Livro {
    compras: BTreeMap<Preco, VecDeque<Ordem>>,
    vendas: BTreeMap<Preco, VecDeque<Ordem>>,
}
impl Livro {
    /// Insere ordem aberta/parcial de um único ativo, sem IDs duplicados.
    pub fn inserir(&mut self, ordem: Ordem) -> Result<(), Rejeicao> {
        if !matches!(ordem.status(), Status::Aberta | Status::Parcial)
            || ordem.restante() == 0
            || self
                .ordens()
                .any(|o| o.id == ordem.id || o.ativo_id != ordem.ativo_id)
        {
            return Err(Rejeicao::EstadoInvalido);
        }
        let niveis = match ordem.lado {
            Lado::Compra => &mut self.compras,
            Lado::Venda => &mut self.vendas,
        };
        let fila = niveis.entry(ordem.preco).or_default();
        let indice = fila
            .iter()
            .position(|o| o.id > ordem.id)
            .unwrap_or(fila.len());
        fila.insert(indice, ordem);
        Ok(())
    }
    /// Itera as ordens abertas para persistência ou snapshot.
    pub fn ordens(&self) -> impl Iterator<Item = &Ordem> {
        self.compras.values().chain(self.vendas.values()).flatten()
    }
    /// Retorna melhor compra (maior preço) ou venda (menor preço).
    pub fn melhor(&self, lado: Lado) -> Option<&Ordem> {
        match lado {
            Lado::Compra => self.compras.last_key_value(),
            Lado::Venda => self.vendas.first_key_value(),
        }
        .and_then(|(_, fila)| fila.front())
    }
    /// Remove uma ordem e elimina níveis vazios.
    pub fn remover(&mut self, id: i64) -> Option<Ordem> {
        for niveis in [&mut self.compras, &mut self.vendas] {
            let preco = niveis
                .iter()
                .find(|(_, fila)| fila.iter().any(|o| o.id == id))
                .map(|(p, _)| *p);
            if let Some(preco) = preco {
                let fila = niveis.get_mut(&preco)?;
                let indice = fila.iter().position(|o| o.id == id)?;
                let ordem = fila.remove(indice);
                if fila.is_empty() {
                    niveis.remove(&preco);
                }
                return ordem;
            }
        }
        None
    }
}
