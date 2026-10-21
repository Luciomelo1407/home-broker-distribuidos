export type Centavos = bigint;

const FORMATO_DINHEIRO_RE = /^-?\d+(\.\d{1,2})?$/;

export function validarDinheiro(valor: string): boolean {
  if (typeof valor !== 'string') {
    return false;
  }
  return FORMATO_DINHEIRO_RE.test(valor.trim());
}

export function paraCentavos(valor: string): Centavos {
  const limpo = valor.trim();
  if (!FORMATO_DINHEIRO_RE.test(limpo)) {
    throw new Error(`Formato de valor monetário inválido: "${valor}"`);
  }

  const negativo = limpo.startsWith('-');
  const semSinal = negativo ? limpo.slice(1) : limpo;
  const [inteiro = '0', decimal = ''] = semSinal.split('.');

  const centavosNormalizados = (decimal + '00').slice(0, 2);
  const total = BigInt(inteiro) * 100n + BigInt(centavosNormalizados);

  return negativo ? -total : total;
}

export function formatarDinheiro(centavos: Centavos | number): string {
  const valor = typeof centavos === 'number' ? BigInt(Math.trunc(centavos)) : centavos;
  const negativo = valor < 0n;
  const absoluto = negativo ? -valor : valor;

  const inteiro = absoluto / 100n;
  const resto = absoluto % 100n;
  const restoFormatado = resto.toString().padStart(2, '0');

  return `${negativo ? '-' : ''}${inteiro}.${restoFormatado}`;
}

export function somar(a: Centavos, b: Centavos): Centavos {
  return a + b;
}

export function subtrair(a: Centavos, b: Centavos): Centavos {
  return a - b;
}

export function multiplicarPorQuantidade(
  precoCentavos: Centavos,
  quantidade: number | bigint,
): Centavos {
  const qtdBig = typeof quantidade === 'number' ? BigInt(Math.trunc(quantidade)) : quantidade;
  return precoCentavos * qtdBig;
}
