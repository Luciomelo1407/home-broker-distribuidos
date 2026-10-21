import { ajustar, centavos, emReais, melhorCompra, melhorVenda, sortear } from './precos.ts';

/** Até quantos pontos-base (1% = 100) além do preço atual o agressivo paga ou aceita. */
const FAIXA_PB = 200;
/** Variação % desde a referência a partir da qual o agressivo realiza em vez de seguir. */
const LIMITE_DA_TENDENCIA = 8;
import type { Estrategia, IntencaoDeOrdem } from './tipos.ts';

/** Percentual do saldo que uma compra agressiva pode comprometer. */
const PERCENTUAL_DO_SALDO = 10n;

/**
 * Perfil agressivo (RF-020): ordens maiores que seguem a tendência. Compara o preço atual
 * de cada ativo com o da decisão anterior: se subiu, compra; se caiu, vende; parado, sorteia.
 * Cruza o spread para executar na hora: compra na melhor venda (ou até 1% acima do preço
 * atual) e vende na melhor compra (ou até 1% abaixo). Isso consome o livro e empurra o
 * preço na direção da tendência. Nunca paga mais que 2% acima nem aceita menos que 2%
 * abaixo do preço atual (RF-019): se a melhor oferta estiver além disso, a ordem fica no
 * livro no limite da faixa, e o preço anda aos poucos em vez de saltar.
 *
 * Realização: com o ativo mais de 8% acima da referência ele vende, e mais de 8% abaixo ele
 * compra, mesmo contra a tendência. Sem isso, seguir a tendência se realimenta (compra
 * porque subiu, sobe porque comprou) até o dinheiro dos agentes acabar.
 */
export const agressiva: Estrategia = {
  perfil: 'agressivo',
  intervaloMs: 1_500,

  decidir(mercado, carteira, aleatorio): IntencaoDeOrdem[] {
    const ativos = Object.keys(mercado.precos);
    if (ativos.length === 0) return [];
    // O ativo que mais se moveu desde a última decisão; empate (ou nada mudou) sorteia
    const variacao = (ativo: string) => {
      const antes = mercado.precosAnteriores[ativo];
      const agora = mercado.precos[ativo];
      return antes && agora ? Number(centavos(agora) - centavos(antes)) : 0;
    };
    const ordenados = [...ativos].sort((a, b) => Math.abs(variacao(b)) - Math.abs(variacao(a)));
    const ativo =
      variacao(ordenados[0] ?? '') !== 0
        ? (ordenados[0] as string)
        : (ativos[Math.floor(aleatorio() * ativos.length)] as string);
    const atual = mercado.precos[ativo];
    if (atual === undefined) return [];
    const tendencia = variacao(ativo);
    const desdeReferencia = Number(mercado.variacoes[ativo] ?? '0');
    const comprar =
      desdeReferencia > LIMITE_DA_TENDENCIA
        ? false
        : desdeReferencia < -LIMITE_DA_TENDENCIA
          ? true
          : tendencia > 0 || (tendencia === 0 && aleatorio() < 0.5);
    const livro = mercado.livros[ativo];
    const preco = centavos(atual);

    if (comprar) {
      const teto = ajustar(preco, FAIXA_PB);
      const venda = melhorVenda(livro);
      const lance =
        venda === undefined
          ? ajustar(preco, sortear(aleatorio, 10, 100))
          : venda < teto
            ? venda
            : teto;
      const orcamento = (centavos(carteira.saldoDisponivel) * PERCENTUAL_DO_SALDO) / 100n;
      const quantidade = Math.min(
        sortear(aleatorio, 20, 100),
        lance > 0n ? Number(orcamento / lance) : 0,
      );
      return quantidade > 0 ? [{ ativo, lado: 'COMPRA', quantidade, preco: emReais(lance) }] : [];
    }

    const disponivel = carteira.posicoes.find((p) => p.ativo === ativo)?.quantidadeDisponivel ?? 0;
    if (disponivel === 0) return [];
    const piso = ajustar(preco, -FAIXA_PB);
    const compra = melhorCompra(livro);
    const oferta =
      compra === undefined
        ? ajustar(preco, -sortear(aleatorio, 10, 100))
        : compra > piso
          ? compra
          : piso;
    const quantidade = Math.min(sortear(aleatorio, 20, 100), disponivel);
    return [{ ativo, lado: 'VENDA', quantidade, preco: emReais(oferta) }];
  },
};
