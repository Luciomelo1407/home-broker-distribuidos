/**
 * Formatação para a tela (RNF-10: o Home Broker só formata; não faz conta de mercado).
 * Os valores chegam como string decimal ("1234.5", "-0.75") e são formatados como texto,
 * sem passar por `number`, para não perder centavos.
 */

function separarMilhares(inteiro: string): string {
  return inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function partes(valor: string): { sinal: string; inteiro: string; casas: string } {
  const limpo = valor.trim();
  const sinal = limpo.startsWith('-') ? '-' : '';
  const [inteiro = '0', casas = ''] = limpo.replace(/^[-+]/, '').split('.');
  return {
    sinal,
    inteiro: inteiro.replace(/^0+(?=\d)/, '') || '0',
    casas: (casas + '00').slice(0, 2),
  };
}

/**
 * "1234.5" → "R$ 1.234,50", "-10.00" → "-R$ 10,00".
 * Se `opcoes?.comSinal` for true e positivo: "+R$ 10,00".
 */
export function formatarDinheiro(valor: string, opcoes?: { comSinal?: boolean }): string {
  const { sinal, inteiro, casas } = partes(valor);
  const zero = /^0*$/.test(inteiro + casas);
  let prefixoSinal = sinal;
  if (opcoes?.comSinal && !zero && !sinal) {
    prefixoSinal = '+';
  }
  return `${prefixoSinal}R$ ${separarMilhares(inteiro)},${casas}`;
}

/** "1.42" → "+1,42%", "-0.75" → "-0,75%", "0.00" → "0,00%" */
export function formatarVariacao(valor: string): string {
  const { sinal, inteiro, casas } = partes(valor);
  const zero = /^0*$/.test(inteiro + casas);
  return `${zero ? '' : sinal || '+'}${separarMilhares(inteiro)},${casas}%`;
}

/** 50000 → "50.000" */
export function formatarQuantidade(valor: number): string {
  return separarMilhares(String(valor));
}

/** "2026-10-21T14:30:00.123Z" → "11:30:00" no fuso do navegador */
export function formatarHora(momento: string): string {
  const data = new Date(momento);
  return Number.isNaN(data.getTime()) ? momento : data.toLocaleTimeString('pt-BR');
}

/** Converte string decimal para centavos inteiros (BigInt) sem passar por float. */
export function paraCentavos(valor: string): bigint {
  const limpo = valor.trim();
  const negativo = limpo.startsWith('-');
  const semSinal = negativo ? limpo.slice(1) : limpo;
  const [inteiro = '0', decimal = ''] = semSinal.split('.');
  const centavosNormalizados = (decimal + '00').slice(0, 2);
  const total = BigInt(inteiro) * 100n + BigInt(centavosNormalizados);
  return negativo ? -total : total;
}

/** Converte centavos inteiros (BigInt) para string decimal "12.34". */
export function formatarCentavos(centavos: bigint): string {
  const negativo = centavos < 0n;
  const absoluto = negativo ? -centavos : centavos;
  const inteiro = absoluto / 100n;
  const resto = (absoluto % 100n).toString().padStart(2, '0');
  return `${negativo ? '-' : ''}${inteiro}.${resto}`;
}

/**
 * Calcula o spread entre a melhor venda (menor preço) e a melhor compra (maior preço).
 * Utiliza aritmética exata em centavos (BigInt) preservando precisão monetária.
 */
export function calcularSpread(livro?: {
  ofertasCompra?: { preco: string }[];
  ofertasVenda?: { preco: string }[];
}): { spreadCentavos?: bigint; spreadTexto: string } {
  const melhorCompra = livro?.ofertasCompra?.[0]?.preco;
  const melhorVenda = livro?.ofertasVenda?.[0]?.preco;
  if (!melhorCompra || !melhorVenda) {
    return { spreadTexto: '—' };
  }
  try {
    const diff = paraCentavos(melhorVenda) - paraCentavos(melhorCompra);
    const decimal = formatarCentavos(diff);
    return { spreadCentavos: diff, spreadTexto: formatarDinheiro(decimal) };
  } catch {
    return { spreadTexto: '—' };
  }
}

