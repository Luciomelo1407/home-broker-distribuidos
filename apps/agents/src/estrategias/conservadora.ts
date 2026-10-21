import {
  ajustar,
  centavos,
  emReais,
  limitar,
  melhorCompra,
  melhorVenda,
  sortear,
} from './precos.ts';
import type { Estrategia, IntencaoDeOrdem } from './tipos.ts';

/** Percentual do saldo que uma compra conservadora pode comprometer. */
const PERCENTUAL_DO_SALDO = 2n;
/** Até quantos pontos-base (1% = 100) do preço atual o conservador aceita negociar. */
const FAIXA_PB = 100;
/** Quantas ordens abertas o agente aceita ter antes de esperar o livro andar. */
const MAXIMO_ABERTAS = 4;

/**
 * Perfil conservador (RF-020): ordens pequenas, com preço colado ao atual e sem cruzar o
 * spread. Compra um centavo acima da melhor compra, ou até 0,5% abaixo do preço atual
 * quando o livro está vazio; vende um centavo abaixo da melhor venda, ou até 0,5% acima.
 * O preço nunca sai de 1% do preço atual (RF-019), mesmo que o livro tenha ofertas
 * absurdas. Assim ele dá liquidez ao livro em vez de consumi-la, e quase não move o preço.
 */
export const conservadora: Estrategia = {
  perfil: 'conservador',
  intervaloMs: 3_000,

  decidir(mercado, carteira, aleatorio): IntencaoDeOrdem[] {
    if (carteira.ordensAbertas.length >= MAXIMO_ABERTAS) return [];
    const ativos = Object.keys(mercado.precos);
    const ativo = ativos[Math.floor(aleatorio() * ativos.length)];
    const atual = ativo === undefined ? undefined : mercado.precos[ativo];
    if (ativo === undefined || atual === undefined) return [];
    const livro = mercado.livros[ativo];
    const preco = centavos(atual);

    if (aleatorio() < 0.5) {
      const alvo = melhorCompra(livro);
      const venda = melhorVenda(livro);
      let lance = limitar(
        alvo === undefined ? ajustar(preco, -sortear(aleatorio, 0, 50)) : alvo + 1n,
        ajustar(preco, -FAIXA_PB),
        preco,
      );
      // Nunca cruza o spread: comprar a mercado é coisa do agressivo
      if (venda !== undefined && lance >= venda) lance = venda - 1n;
      const orcamento = (centavos(carteira.saldoDisponivel) * PERCENTUAL_DO_SALDO) / 100n;
      const maximo = lance > 0n ? Number(orcamento / lance) : 0;
      const quantidade = Math.min(sortear(aleatorio, 1, 10), maximo);
      return quantidade > 0 ? [{ ativo, lado: 'COMPRA', quantidade, preco: emReais(lance) }] : [];
    }

    const posicao = carteira.posicoes.find((p) => p.ativo === ativo);
    const disponivel = posicao?.quantidadeDisponivel ?? 0;
    if (disponivel === 0) return [];
    const alvo = melhorVenda(livro);
    const compra = melhorCompra(livro);
    let oferta = limitar(
      alvo === undefined ? ajustar(preco, sortear(aleatorio, 0, 50)) : alvo - 1n,
      preco,
      ajustar(preco, FAIXA_PB),
    );
    if (compra !== undefined && oferta <= compra) oferta = compra + 1n;
    const quantidade = Math.min(sortear(aleatorio, 1, 10), disponivel);
    return [{ ativo, lado: 'VENDA', quantidade, preco: emReais(oferta) }];
  },
};
