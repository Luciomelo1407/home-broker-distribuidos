import { describe, expect, it } from 'vitest';
import { ErroApi } from '../api/rest';
import { gerarClientOrderId, prepararOrdem, TentativaOrdem } from './tentativa-ordem';

const dados = prepararOrdem('ABC3', 'COMPRA', '10', '25,50');
describe('intenção de ordem', () => {
  it('F5 restaura exatamente a intenção incerta e a confirmação a remove', () => {
    const mapa = new Map<string, string>();
    const armazenamento = {
      getItem: (chave: string) => mapa.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        mapa.set(chave, valor);
      },
      removeItem: (chave: string) => {
        mapa.delete(chave);
      },
    };
    const primeira = new TentativaOrdem();
    primeira.restaurar(armazenamento, 'investidor-1');
    const corpo = primeira.iniciar(dados)!;
    primeira.falhar(new ErroApi('SEM_CONEXAO', 'rede', 0), corpo.clientOrderId);
    const depoisDoF5 = new TentativaOrdem();
    expect(depoisDoF5.restaurar(armazenamento, 'investidor-1')).toEqual(corpo);
    expect(depoisDoF5.iniciar({ ...dados, quantidade: 999 })).toEqual(corpo);
    depoisDoF5.confirmar();
    expect(armazenamento.getItem('investidor-1')).toBeNull();
  });

  it('outro investidor não restaura a intenção privada da chave anterior', () => {
    const armazenamento = {
      getItem: (chave: string) =>
        chave === 'investidor-1'
          ? JSON.stringify({ ...dados, clientOrderId: gerarClientOrderId() })
          : null,
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(new TentativaOrdem().restaurar(armazenamento, 'investidor-2')).toBeUndefined();
  });
  it('gera UUID v4 sem depender de crypto.randomUUID em HTTP por IP', () => {
    expect(gerarClientOrderId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(gerarClientOrderId()).not.toBe(gerarClientOrderId());
  });
  it.each(['0', '-1', '1.5', '1e3', '2147483648'])(
    'rejeita quantidade %s antes de enviar',
    (quantidade) => {
      expect(() => prepararOrdem('ABC3', 'COMPRA', quantidade, '1')).toThrow();
    },
  );
  it.each(['0', '0.00', '-1', '1e3', '1.001', '99999999999999'])('rejeita preço %s', (preco) => {
    expect(() => prepararOrdem('ABC3', 'COMPRA', '1', preco)).toThrow();
  });
  it('bloqueia clique repetido enquanto a requisição está em andamento', () => {
    const tentativa = new TentativaOrdem();
    expect(tentativa.iniciar(dados)).toBeDefined();
    expect(tentativa.iniciar(dados)).toBeUndefined();
  });
  it.each([
    new ErroApi('SEM_CONEXAO', 'rede', 0),
    new ErroApi('NAO_CONFIRMADA', 'timeout', 504),
    new Error('erro genérico'),
  ])('mantém corpo e id depois de resultado incerto', (erro) => {
    const tentativa = new TentativaOrdem();
    const primeira = tentativa.iniciar(dados)!;
    tentativa.falhar(erro, primeira.clientOrderId);
    expect(tentativa.iniciar({ ...dados, quantidade: 999 })).toEqual(primeira);
  });
  it('recusa definitiva libera uma nova intenção com outro UUID', () => {
    const tentativa = new TentativaOrdem();
    const primeira = tentativa.iniciar(dados)!;
    tentativa.falhar(new ErroApi('VALIDACAO', 'inválida', 400), primeira.clientOrderId);
    expect(tentativa.iniciar(dados)?.clientOrderId).not.toBe(primeira.clientOrderId);
  });
  it('confirmação por evento impede que um erro HTTP atrasado marque a intenção como incerta', () => {
    const tentativa = new TentativaOrdem();
    const primeira = tentativa.iniciar(dados)!;
    tentativa.reconhecer([
      { ...primeira, id: 1, precoLimite: primeira.preco, quantidadeExecutada: 0, status: 'ABERTA' },
    ]);
    expect(tentativa.falhar(new Error('rede'), primeira.clientOrderId)).toBe(false);
    expect(tentativa.estaIncerta()).toBe(false);
  });
});
