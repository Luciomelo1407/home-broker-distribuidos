import { describe, expect, it } from 'vitest';
import {
  formatarDinheiro,
  multiplicarPorQuantidade,
  paraCentavos,
  somar,
  subtrair,
  validarDinheiro,
} from './dinheiro.js';

describe('dinheiro', () => {
  describe('validarDinheiro', () => {
    it('aceita valores válidos inteiros e com até duas casas decimais', () => {
      expect(validarDinheiro('100')).toBe(true);
      expect(validarDinheiro('100.5')).toBe(true);
      expect(validarDinheiro('100.50')).toBe(true);
      expect(validarDinheiro('0.01')).toBe(true);
      expect(validarDinheiro('-50.25')).toBe(true);
    });

    it('rejeita formatos inválidos e com mais de duas casas', () => {
      expect(validarDinheiro('100.555')).toBe(false);
      expect(validarDinheiro('100,50')).toBe(false);
      expect(validarDinheiro('abc')).toBe(false);
      expect(validarDinheiro('')).toBe(false);
      expect(validarDinheiro('10.2.1')).toBe(false);
    });
  });

  describe('paraCentavos', () => {
    it('converte strings decimais para BigInt em centavos sem erro de ponto flutuante', () => {
      expect(paraCentavos('102.55')).toBe(10255n);
      expect(paraCentavos('102.5')).toBe(10250n);
      expect(paraCentavos('102')).toBe(10200n);
      expect(paraCentavos('0.05')).toBe(5n);
      expect(paraCentavos('0.00')).toBe(0n);
      expect(paraCentavos('100000.00')).toBe(10000000n);
    });

    it('suporta números negativos', () => {
      expect(paraCentavos('-0.50')).toBe(-50n);
      expect(paraCentavos('-10.25')).toBe(-1025n);
    });

    it('lança erro ao receber string com formato inválido', () => {
      expect(() => paraCentavos('10.999')).toThrow('Formato de valor monetário inválido');
      expect(() => paraCentavos('invalido')).toThrow('Formato de valor monetário inválido');
    });
  });

  describe('formatarDinheiro', () => {
    it('formata BigInt de centavos para string com duas casas decimais', () => {
      expect(formatarDinheiro(10255n)).toBe('102.55');
      expect(formatarDinheiro(10250n)).toBe('102.50');
      expect(formatarDinheiro(5n)).toBe('0.05');
      expect(formatarDinheiro(0n)).toBe('0.00');
      expect(formatarDinheiro(10000000n)).toBe('100000.00');
      expect(formatarDinheiro(-50n)).toBe('-0.50');
    });

    it('suporta entrada numérica inteira', () => {
      expect(formatarDinheiro(5025)).toBe('50.25');
    });
  });

  describe('operações aritméticas', () => {
    it('soma centavos com precisão exata', () => {
      const a = paraCentavos('10.25');
      const b = paraCentavos('20.80');
      expect(formatarDinheiro(somar(a, b))).toBe('31.05');
    });

    it('subtrai centavos corretamente', () => {
      const a = paraCentavos('50.00');
      const b = paraCentavos('12.35');
      expect(formatarDinheiro(subtrair(a, b))).toBe('37.65');
    });

    it('multiplica preço por quantidade inteira', () => {
      const preco = paraCentavos('25.50');
      const total = multiplicarPorQuantidade(preco, 100);
      expect(formatarDinheiro(total)).toBe('2550.00');
    });
  });
});
