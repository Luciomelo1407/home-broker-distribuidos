//! RF-014/015: planejamento puro das execuções ao preço da ordem passiva.
use super::{Lado, Livro, Ordem, Preco};
/// Negócio calculado, ainda não persistido.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Execucao {
    pub compra_id: i64,
    pub venda_id: i64,
    pub preco: Preco,
    pub quantidade: u32,
}
/// Calcula negócios sem alterar livro ou ordem recebida.
pub fn casar(livro: &Livro, ordem: &Ordem) -> Vec<Execucao> {
    let mut candidatos: Vec<_> = livro
        .ordens()
        .filter(|o| o.ativo_id == ordem.ativo_id && o.lado != ordem.lado)
        .collect();
    candidatos.sort_by(|a, b| {
        let preco = match ordem.lado {
            Lado::Compra => a.preco.cmp(&b.preco),
            Lado::Venda => b.preco.cmp(&a.preco),
        };
        preco.then(a.id.cmp(&b.id))
    });
    let mut restante = ordem.restante();
    let mut execucoes = Vec::new();
    for passiva in candidatos {
        let compativel = match ordem.lado {
            Lado::Compra => ordem.preco >= passiva.preco,
            Lado::Venda => ordem.preco <= passiva.preco,
        };
        if restante == 0 || !compativel {
            break;
        }
        let quantidade = restante.min(passiva.restante());
        let (compra_id, venda_id) = match ordem.lado {
            Lado::Compra => (ordem.id, passiva.id),
            Lado::Venda => (passiva.id, ordem.id),
        };
        execucoes.push(Execucao {
            compra_id,
            venda_id,
            preco: passiva.preco,
            quantidade,
        });
        restante -= quantidade;
    }
    execucoes
}
