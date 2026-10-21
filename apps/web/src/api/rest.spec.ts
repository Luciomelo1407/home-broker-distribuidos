import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, resultadoIncerto, TIMEOUT_REQUISICAO_MS } from './rest';

beforeEach(() => vi.stubEnv('NEXT_PUBLIC_GATEWAY_URL', 'http://localhost:3001'));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('transporte REST', () => {
  it('falha de rede conserva a classificação de resultado incerto', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('rede')));
    try {
      await api.mercado();
      throw new Error('deveria falhar');
    } catch (erro) {
      expect(resultadoIncerto(erro)).toBe(true);
    }
  });
  it('sucesso HTTP com JSON inválido não confirma a operação', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('não é JSON', { status: 200 })));
    await expect(api.mercado()).rejects.toMatchObject({ codigo: 'RESPOSTA_INVALIDA', status: 0 });
  });
  it('resposta de outra intenção não confirma a ordem enviada', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          id: 1,
          clientOrderId: 'outro',
          status: 'ABERTA',
          quantidade: 1,
          quantidadeExecutada: 0,
          precoLimite: '1.00',
        }),
      ),
    );
    await expect(
      api.enviarOrdem('token', {
        clientOrderId: 'original',
        ativo: 'ABC3',
        lado: 'COMPRA',
        quantidade: 1,
        preco: '1.00',
      }),
    ).rejects.toMatchObject({ codigo: 'RESPOSTA_INVALIDA' });
  });
  it('401 preserva o código para encerrar a sessão', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { erro: { codigo: 'NAO_AUTENTICADO', mensagem: 'expirou' } },
            { status: 401 },
          ),
        ),
    );
    await expect(api.carteira('token')).rejects.toMatchObject({
      codigo: 'NAO_AUTENTICADO',
      status: 401,
    });
  });
  it('consulta privada desativa cache e usa a identidade do token', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ativos: [] }));
    vi.stubGlobal('fetch', fetch);
    await api.carteira('token-teste');
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3001/carteira',
      expect.objectContaining({
        cache: 'no-store',
        headers: expect.objectContaining({ authorization: 'Bearer token-teste' }),
      }),
    );
  });
  it('requisição sem resposta é abortada em tempo limitado', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) =>
            init.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
          ),
      ),
    );
    const pendente = expect(api.mercado()).rejects.toMatchObject({
      codigo: 'SEM_CONEXAO',
      status: 0,
    });
    await vi.advanceTimersByTimeAsync(TIMEOUT_REQUISICAO_MS);
    await pendente;
  });
});
