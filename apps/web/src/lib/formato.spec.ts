import { describe, expect, it } from 'vitest';
import { formatarDinheiro, formatarQuantidade, formatarVariacao } from './formato';

describe('formatação', () => {
  it.each([
    ['0', 'R$ 0,00'],
    ['25.5', 'R$ 25,50'],
    ['1234567.89', 'R$ 1.234.567,89'],
    ['-10.00', '-R$ 10,00'],
  ])('dinheiro %s → %s', (valor, esperado) => {
    expect(formatarDinheiro(valor)).toBe(esperado);
  });

  it.each([
    ['0', 'R$ 0,00'],
    ['0.00', 'R$ 0,00'],
    ['150.00', '+R$ 150,00'],
    ['-150.00', '-R$ 150,00'],
  ])('dinheiro com sinal %s → %s', (valor, esperado) => {
    expect(formatarDinheiro(valor, { comSinal: true })).toBe(esperado);
  });

  it.each([
    ['1.42', '+1,42%'],
    ['-0.75', '-0,75%'],
    ['0.00', '0,00%'],
    ['8900.00', '+8.900,00%'],
  ])('variação %s → %s', (valor, esperado) => {
    expect(formatarVariacao(valor)).toBe(esperado);
  });

  it('quantidade com separador de milhar', () => {
    expect(formatarQuantidade(50000)).toBe('50.000');
  });
});
