import { formatarDinheiro, paraCentavos } from '@bolsa/contracts/src/dinheiro.ts';
import type { LivroRespostaDto } from '@bolsa/contracts';

/**
 * Contas de preço das estratégias em centavos inteiros (regra 3.3.1: o helper do
 * contracts, nunca `number` com decimais). Só dados de entrada de ordem: quem decide se a
 * ordem passa é o Motor, como para os humanos (RF-019).
 */
export const UM_CENTAVO = 1n;

export function centavos(preco: string): bigint {
  return paraCentavos(preco);
}

export function emReais(valor: bigint): string {
  return formatarDinheiro(valor < UM_CENTAVO ? UM_CENTAVO : valor);
}

/** `preco` multiplicado por (1 + pontosBase/10000), arredondado para o centavo. */
export function ajustar(preco: bigint, pontosBase: number): bigint {
  return (preco * BigInt(10_000 + Math.round(pontosBase)) + 5_000n) / 10_000n;
}

export function melhorCompra(livro?: LivroRespostaDto): bigint | undefined {
  const preco = livro?.ofertasCompra[0]?.preco;
  return preco === undefined ? undefined : centavos(preco);
}

export function melhorVenda(livro?: LivroRespostaDto): bigint | undefined {
  const preco = livro?.ofertasVenda[0]?.preco;
  return preco === undefined ? undefined : centavos(preco);
}

/** Inteiro sorteado em [min, max]. */
export function sortear(aleatorio: () => number, min: number, max: number): number {
  return min + Math.floor(aleatorio() * (max - min + 1));
}

/** `valor` limitado a [minimo, maximo]. */
export function limitar(valor: bigint, minimo: bigint, maximo: bigint): bigint {
  return valor < minimo ? minimo : valor > maximo ? maximo : valor;
}
