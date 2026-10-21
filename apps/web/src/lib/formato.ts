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
  return { sinal, inteiro: inteiro.replace(/^0+(?=\d)/, ''), casas: (casas + '00').slice(0, 2) };
}

/** "1234.5" → "R$ 1.234,50" */
export function formatarDinheiro(valor: string): string {
  const { sinal, inteiro, casas } = partes(valor);
  return `${sinal}R$ ${separarMilhares(inteiro)},${casas}`;
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
