//! T-01 a T-05 e T-11: exemplos e conservação sob comandos aleatórios.
use engine::domain::*;
use proptest::prelude::*;
use rust_decimal::Decimal;
use std::collections::BTreeMap;
#[allow(clippy::unwrap_used)] // Fixtures: permitido pela regra 3.3.6.
fn preco(v: i64) -> Preco {
    Preco::novo(Decimal::from(v)).unwrap()
}
#[allow(clippy::unwrap_used)] // Fixtures: permitido pela regra 3.3.6.
fn ordem(id: i64, dono: i32, lado: Lado, qtd: u32, valor: i64) -> Ordem {
    Ordem::nova(
        id,
        dono,
        1,
        lado,
        preco(valor),
        Quantidade::nova(qtd).unwrap(),
    )
}
#[allow(clippy::unwrap_used)] // Fixtures: permitido pela regra 3.3.6.
fn estado() -> Estado {
    let mut e = Estado::default();
    e.mercados.insert(
        1,
        Mercado {
            referencia: preco(100),
            ultimo: preco(100),
            volume: 0,
        },
    );
    for id in 1..=3 {
        e.contas.insert(
            id,
            Conta {
                disponivel: Dinheiro::novo(Decimal::from(100_000)).unwrap(),
                reservado: Dinheiro::default(),
                posicoes: BTreeMap::from([(
                    1,
                    Posicao {
                        disponivel: 1000,
                        reservada: 0,
                        preco_medio: Decimal::from(100),
                    },
                )]),
            },
        );
    }
    e
}
#[test]
fn valores_invalidos_e_limites() {
    for valor in [Decimal::ZERO, Decimal::NEGATIVE_ONE, Decimal::new(1001, 3)] {
        assert!(Preco::novo(valor).is_err());
    }
    assert!(Quantidade::nova(0).is_err());
    assert!(Quantidade::nova(u32::MAX).is_err());
    assert!(Dinheiro::novo(Decimal::NEGATIVE_ONE).is_err());
    assert!(Dinheiro::novo(Decimal::ZERO).is_ok());
    assert!(Preco::novo(Decimal::from(10_000_000_000_000_i64)).is_err());
    assert!(
        preco(9_999_999_999_999)
            .total(Quantidade::nova(2).unwrap())
            .is_err()
    );
}
#[test]
fn t01_exemplo_e_execucao_parcial() {
    let e = estado()
        .criar(ordem(1, 1, Lado::Venda, 100, 102))
        .unwrap()
        .estado;
    let e = e.criar(ordem(2, 2, Lado::Compra, 100, 101)).unwrap().estado;
    assert_eq!(e.livros[&1].melhor(Lado::Venda).unwrap().preco, preco(102));
    assert_eq!(e.livros[&1].melhor(Lado::Compra).unwrap().preco, preco(101));
    let r = e.criar(ordem(3, 3, Lado::Compra, 150, 102)).unwrap();
    assert_eq!(r.execucoes.len(), 1);
    assert_eq!(r.execucoes[0].quantidade, 100);
    assert_eq!(r.estado.ordens[&3].restante(), 50);
    assert_eq!(r.estado.ordens[&3].status(), Status::Parcial);
    assert_eq!(r.estado.ordens[&1].status(), Status::Executada);
}
#[test]
fn t02_preco_passivo_e_devolucao_da_diferenca() {
    let e = estado()
        .criar(ordem(1, 1, Lado::Venda, 100, 102))
        .unwrap()
        .estado;
    let r = e.criar(ordem(2, 2, Lado::Compra, 150, 105)).unwrap();
    assert_eq!(r.execucoes[0].preco, preco(102));
    let conta = &r.estado.contas[&2];
    assert_eq!(conta.disponivel.valor(), Decimal::from(84_550));
    assert_eq!(conta.reservado.valor(), Decimal::from(5250));
    assert_eq!(conta.posicoes[&1].preco_medio, Decimal::new(1001818, 4));
    assert_eq!(r.estado.mercados[&1].volume, 100);
    assert_eq!(r.estado.mercados[&1].variacao(), Decimal::from(2));
    assert_eq!(e.ordens.len(), 1); // proposta não alterou o snapshot original
}
#[test]
fn t03_desempate_por_id_e_prioridade_de_preco() {
    let mut livro = Livro::default();
    for (id, valor) in [(3, 102), (2, 102), (1, 103)] {
        livro.inserir(ordem(id, 1, Lado::Venda, 10, valor)).unwrap();
    }
    let exec = engine::domain::casamento::casar(&livro, &ordem(4, 2, Lado::Compra, 30, 105));
    assert_eq!(
        exec.iter().map(|x| x.venda_id).collect::<Vec<_>>(),
        vec![2, 3, 1]
    );
    let mut outro = Livro::default();
    outro.inserir(ordem(1, 1, Lado::Compra, 10, 105)).unwrap();
    outro.inserir(ordem(2, 2, Lado::Compra, 10, 106)).unwrap();
    let exec = engine::domain::casamento::casar(&outro, &ordem(3, 3, Lado::Venda, 15, 100));
    assert_eq!(exec[0].compra_id, 2);
    assert_eq!(exec[0].preco, preco(106));
}
#[test]
fn t04_rejeicoes_nao_alteram_estado() {
    let e = estado();
    let antes = e.clone();
    assert_eq!(
        e.criar(ordem(1, 1, Lado::Compra, 1001, 100)),
        Err(Rejeicao::SaldoInsuficiente)
    );
    assert_eq!(
        e.criar(ordem(2, 1, Lado::Venda, 1001, 100)),
        Err(Rejeicao::AcoesInsuficientes)
    );
    let mut invalida = ordem(3, 1, Lado::Compra, 1, 100);
    invalida.ativo_id = 9;
    assert_eq!(e.criar(invalida), Err(Rejeicao::AtivoInexistente));
    assert_eq!(e, antes);
}
#[test]
fn t11_cancelamento_parcial_e_autorizacao() {
    for lado in [Lado::Compra, Lado::Venda] {
        let oposto = if lado == Lado::Compra {
            Lado::Venda
        } else {
            Lado::Compra
        };
        let e = estado().criar(ordem(1, 1, lado, 100, 100)).unwrap().estado;
        let e = e.criar(ordem(2, 2, oposto, 40, 100)).unwrap().estado;
        assert_eq!(e.cancelar(2, 1), Err(Rejeicao::OrdemDeOutroInvestidor));
        let e = e.cancelar(1, 1).unwrap().estado;
        assert_eq!(e.ordens[&1].executada(), 40);
        assert_eq!(e.ordens[&1].status(), Status::Cancelada);
        assert_eq!(e.contas[&1].reservado.valor(), Decimal::ZERO);
        assert_eq!(e.contas[&1].posicoes[&1].reservada, 0);
        assert_eq!(e.cancelar(1, 1), Err(Rejeicao::OrdemNaoCancelavel));
        assert_eq!(e.cancelar(1, 999), Err(Rejeicao::OrdemNaoEncontrada));
    }
}
fn invariantes(e: &Estado) {
    let dinheiro: Decimal = e
        .contas
        .values()
        .map(|c| c.disponivel.valor() + c.reservado.valor())
        .sum();
    assert_eq!(dinheiro, Decimal::from(300_000));
    let acoes: u32 = e
        .contas
        .values()
        .map(|c| c.posicoes[&1].disponivel + c.posicoes[&1].reservada)
        .sum();
    assert_eq!(acoes, 3000);
    for (id, c) in &e.contas {
        assert!(c.disponivel.valor() >= Decimal::ZERO);
        let abertas: Vec<_> = e
            .ordens
            .values()
            .filter(|o| {
                o.investidor_id == *id && matches!(o.status(), Status::Aberta | Status::Parcial)
            })
            .collect();
        let reserva: Decimal = abertas
            .iter()
            .filter(|o| o.lado == Lado::Compra)
            .map(|o| o.preco.valor() * Decimal::from(o.restante()))
            .sum();
        let reservadas: u32 = abertas
            .iter()
            .filter(|o| o.lado == Lado::Venda)
            .map(|o| o.restante())
            .sum();
        assert_eq!(c.reservado.valor(), reserva);
        assert_eq!(c.posicoes[&1].reservada, reservadas);
    }
    for o in e.ordens.values() {
        let no_livro = e.livros.values().flat_map(|l| l.ordens()).any(|x| x == o);
        assert_eq!(
            no_livro,
            matches!(o.status(), Status::Aberta | Status::Parcial)
        );
    }
}
proptest! {
    #[test]
    fn t05_conservacao(acoes in prop::collection::vec((0u8..5, 1i32..4, 1u32..2000, 80i64..121, 0u16..150), 1..150)) {
        let mut e = estado();
        for (indice, (tipo, dono, qtd, valor, alvo)) in acoes.into_iter().enumerate() {
            let r = if tipo == 4 { e.cancelar(dono, i64::from(alvo) + 1) }
            else { e.criar(ordem(indice as i64 + 1, dono, if tipo % 2 == 0 { Lado::Compra } else { Lado::Venda }, qtd, valor)) };
            if let Ok(r) = r { e = r.estado; }
            invariantes(&e);
        }
    }
}
#[test]
fn recuperacao_e_validacao_do_livro() {
    let base = ordem(1, 1, Lado::Venda, 10, 100);
    assert!(Ordem::restaurar(base.clone(), 11, Status::Executada).is_err());
    assert!(Ordem::restaurar(base.clone(), 0, Status::Parcial).is_err());
    let parcial = Ordem::restaurar(base, 4, Status::Parcial).unwrap();
    let mut livro = Livro::default();
    livro.inserir(parcial.clone()).unwrap();
    assert!(livro.inserir(parcial).is_err());
    let mut outro_ativo = ordem(2, 1, Lado::Venda, 10, 100);
    outro_ativo.ativo_id = 2;
    assert!(livro.inserir(outro_ativo).is_err());
    assert_eq!(livro.remover(1).unwrap().restante(), 6);
    assert!(livro.melhor(Lado::Venda).is_none());
    assert!(livro.remover(1).is_none());
}
#[test]
fn ativos_isolados_e_reserva_compartilhada() {
    let mut e = estado();
    e.mercados.insert(
        2,
        Mercado {
            referencia: preco(100),
            ultimo: preco(100),
            volume: 0,
        },
    );
    let e = e.criar(ordem(1, 1, Lado::Venda, 100, 100)).unwrap().estado;
    let mut compra = ordem(2, 2, Lado::Compra, 900, 100);
    compra.ativo_id = 2;
    let r = e.criar(compra).unwrap();
    assert!(r.execucoes.is_empty());
    assert_eq!(
        r.estado.criar(ordem(3, 2, Lado::Compra, 101, 100)),
        Err(Rejeicao::SaldoInsuficiente)
    );
    assert_eq!(r.estado.mercados[&1].volume, 0);
}
#[test]
fn erro_na_liquidacao_descarta_toda_a_proposta() {
    let mut e = estado()
        .criar(ordem(1, 1, Lado::Venda, 10, 100))
        .unwrap()
        .estado;
    e.mercados.get_mut(&1).unwrap().volume = i64::MAX;
    let antes = e.clone();
    assert_eq!(
        e.criar(ordem(2, 2, Lado::Compra, 10, 100)),
        Err(Rejeicao::ValorInvalido)
    );
    assert_eq!(e, antes);
}
