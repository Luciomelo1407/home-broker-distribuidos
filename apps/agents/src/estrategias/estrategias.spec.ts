import { describe, expect, it } from 'vitest';
import { agressiva } from './agressiva.ts';
import { conservadora } from './conservadora.ts';
import type { CarteiraDoAgente, VisaoDoMercado } from './tipos.ts';

/** Sorteio fixo: devolve os valores na ordem e depois repete o último. */
function sorteio(...valores: number[]): () => number {
  let i = 0;
  return () => valores[Math.min(i++, valores.length - 1)] ?? 0;
}

const carteira: CarteiraDoAgente = {
  saldoDisponivel: '100000.00',
  posicoes: [
    { ativo: 'ABC3', quantidadeDisponivel: 1000, quantidadeReservada: 0, precoMedio: '25.00' },
  ],
  ordensAbertas: [],
};

const mercado = (
  livro?: { compra?: string; venda?: string },
  anterior?: string,
  variacao = '0.00',
): VisaoDoMercado => ({
  precos: { ABC3: '25.00' },
  precosAnteriores: anterior ? { ABC3: anterior } : {},
  variacoes: { ABC3: variacao },
  livros: {
    ABC3: {
      ativo: 'ABC3',
      ofertasCompra: livro?.compra ? [{ preco: livro.compra, quantidade: 10 }] : [],
      ofertasVenda: livro?.venda ? [{ preco: livro.venda, quantidade: 10 }] : [],
    },
  },
});

describe('estratégia conservadora (RF-020)', () => {
  it('compra pouco, um centavo acima da melhor compra, sem cruzar o spread', () => {
    // 0 → ABC3; 0.1 → compra; 0.9 → quantidade 10
    const [ordem] = conservadora.decidir(
      mercado({ compra: '24.90', venda: '25.10' }),
      carteira,
      sorteio(0, 0.1, 0.9),
    );

    expect(ordem).toEqual({ ativo: 'ABC3', lado: 'COMPRA', quantidade: 10, preco: '24.91' });
  });

  it('com spread de um centavo, fica um abaixo da venda em vez de cruzar', () => {
    const [ordem] = conservadora.decidir(
      mercado({ compra: '24.99', venda: '25.00' }),
      carteira,
      sorteio(0, 0.1, 0),
    );

    expect(ordem?.preco).toBe('24.99');
  });

  it('vende um centavo abaixo da melhor venda', () => {
    const [ordem] = conservadora.decidir(
      mercado({ compra: '24.90', venda: '25.10' }),
      carteira,
      sorteio(0, 0.9, 0),
    );

    expect(ordem).toEqual({ ativo: 'ABC3', lado: 'VENDA', quantidade: 1, preco: '25.09' });
  });

  it('com o livro vazio, fica até 0,5% do preço atual', () => {
    const [ordem] = conservadora.decidir(mercado(), carteira, sorteio(0, 0.1, 0.99, 0));

    expect(Number(ordem?.preco)).toBeGreaterThanOrEqual(24.87);
    expect(Number(ordem?.preco)).toBeLessThanOrEqual(25);
  });

  it('espera quando já tem ordens abertas demais', () => {
    const cheia = { ...carteira, ordensAbertas: Array(4).fill({}) };

    expect(conservadora.decidir(mercado(), cheia, sorteio(0))).toEqual([]);
  });

  it('não compra acima de 2% do saldo', () => {
    const pobre = { ...carteira, saldoDisponivel: '100.00' };

    const [ordem] = conservadora.decidir(
      mercado({ compra: '24.90' }),
      pobre,
      sorteio(0, 0.1, 0.99),
    );

    // 2% de R$ 100 = R$ 2, que não paga nem uma ação a R$ 24,91
    expect(ordem).toBeUndefined();
  });
});

describe('estratégia agressiva (RF-020)', () => {
  it('segue a alta: compra na melhor venda, em lote maior', () => {
    const [ordem] = agressiva.decidir(
      mercado({ compra: '25.00', venda: '25.20' }, '24.50'),
      carteira,
      sorteio(0.5),
    );

    expect(ordem?.lado).toBe('COMPRA');
    expect(ordem?.preco).toBe('25.20');
    expect(ordem?.quantidade).toBeGreaterThanOrEqual(20);
  });

  it('segue a queda: vende na melhor compra', () => {
    const [ordem] = agressiva.decidir(
      mercado({ compra: '24.80', venda: '25.20' }, '25.50'),
      carteira,
      sorteio(0.5),
    );

    expect(ordem).toMatchObject({ lado: 'VENDA', preco: '24.80' });
  });

  it('sem livro, cruza até 1% além do preço atual', () => {
    const [ordem] = agressiva.decidir(mercado(undefined, '24.00'), carteira, sorteio(0.99));

    expect(ordem?.lado).toBe('COMPRA');
    expect(Number(ordem?.preco)).toBeGreaterThan(25);
    expect(Number(ordem?.preco)).toBeLessThanOrEqual(25.25);
  });

  it('não vende o que não tem', () => {
    const semAcoes = { ...carteira, posicoes: [] };

    expect(
      agressiva.decidir(mercado({ compra: '24.80' }, '25.50'), semAcoes, sorteio(0.5)),
    ).toEqual([]);
  });

  it('realiza depois de 8% de alta: vende mesmo com o preço subindo', () => {
    const bolha = mercado({ compra: '24.80', venda: '25.20' }, '24.50', '9.50');

    expect(agressiva.decidir(bolha, carteira, sorteio(0.5))[0]?.lado).toBe('VENDA');
  });

  it('compra depois de 8% de queda, mesmo com o preço caindo', () => {
    const tombo = mercado({ compra: '24.80', venda: '25.20' }, '25.50', '-9.00');

    expect(agressiva.decidir(tombo, carteira, sorteio(0.5))[0]?.lado).toBe('COMPRA');
  });

  it('decide com intervalo menor que o conservador', () => {
    expect(agressiva.intervaloMs).toBeLessThan(conservadora.intervaloMs);
  });
});

describe('RF-019: preço sempre perto do atual', () => {
  // Livro com ofertas absurdas que outro participante deixou
  const absurdo = mercado({ compra: '0.50', venda: '90.00' }, '25.00');

  it('o conservador não segue uma compra absurda para baixo', () => {
    const [ordem] = conservadora.decidir(absurdo, carteira, sorteio(0, 0.1, 0.5));

    expect(Number(ordem?.preco)).toBeGreaterThanOrEqual(24.75);
  });

  it('o conservador não vende muito acima do preço atual', () => {
    const [ordem] = conservadora.decidir(absurdo, carteira, sorteio(0, 0.9, 0.5));

    expect(Number(ordem?.preco)).toBeLessThanOrEqual(25.25);
  });

  it('o agressivo não vende numa compra absurda nem compra numa venda absurda', () => {
    const queda = mercado({ compra: '0.50', venda: '90.00' }, '26.00');
    const alta = mercado({ compra: '0.50', venda: '90.00' }, '24.00');

    expect(agressiva.decidir(queda, carteira, sorteio(0.5))[0]).toMatchObject({
      lado: 'VENDA',
      preco: '24.50',
    });
    expect(agressiva.decidir(alta, carteira, sorteio(0.5))[0]).toMatchObject({
      lado: 'COMPRA',
      preco: '25.50',
    });
  });
});
