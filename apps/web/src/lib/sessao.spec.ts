import { afterEach, describe, expect, it, vi } from 'vitest';
import { encerrarSessao, lerSessao } from './sessao';

afterEach(() => vi.unstubAllGlobals());
describe('sessão persistida', () => {
  it.each([
    'null',
    '{}',
    '[]',
    '{"token":"t","investidor":{}}',
    '{"token":"","investidor":{"id":1,"nomeUsuario":"ana"}}',
    'não-json',
  ])('recusa armazenamento inválido %s', (texto) => {
    vi.stubGlobal('localStorage', { getItem: () => texto });
    expect(lerSessao()).toBeUndefined();
  });
  it('aceita o formato emitido pelo login real', () => {
    const sessao = { token: 'token', investidor: { id: 1, nomeUsuario: 'ana' } };
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(sessao) });
    expect(lerSessao()).toEqual(sessao);
  });
  it('sair não falha quando o navegador bloqueia armazenamento', () => {
    vi.stubGlobal('localStorage', {
      removeItem: () => {
        throw new Error('bloqueado');
      },
    });
    expect(encerrarSessao).not.toThrow();
  });
});
