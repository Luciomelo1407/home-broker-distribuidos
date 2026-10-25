import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClienteGateway, ErroGateway } from './gateway.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('cliente REST dos agentes', () => {
  it('usa o token novo após outro login e limita o tempo de cada requisição', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ token: 'antigo' }))
      .mockResolvedValueOnce(
        Response.json({ erro: { codigo: 'NAO_AUTENTICADO', mensagem: 'venceu' } }, { status: 401 }),
      )
      .mockResolvedValueOnce(Response.json({ token: 'novo' }))
      .mockResolvedValueOnce(Response.json({ saldoDisponivel: '100.00' }));
    vi.stubGlobal('fetch', fetch);
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const cliente = new ClienteGateway('http://gateway');
    await cliente.entrar('teste', 'senha');
    await expect(cliente.carteira()).rejects.toMatchObject({
      status: 401,
      codigo: 'NAO_AUTENTICADO',
    });
    await cliente.entrar('teste', 'senha');
    await cliente.carteira();
    expect(fetch.mock.calls[1]?.[1].headers.authorization).toBe('Bearer antigo');
    expect(fetch.mock.calls[3]?.[1].headers.authorization).toBe('Bearer novo');
    expect(timeout).toHaveBeenCalledTimes(4);
    expect(timeout).toHaveBeenCalledWith(5000);
  });

  it('não repete uma ordem quando a resposta se perde ou o pedido expira', async () => {
    const fetch = vi.fn().mockRejectedValue(new DOMException('timeout', 'TimeoutError'));
    vi.stubGlobal('fetch', fetch);
    const cliente = new ClienteGateway('http://gateway');
    await expect(
      cliente.enviarOrdem({
        clientOrderId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        ativo: 'ABC3',
        lado: 'COMPRA',
        quantidade: 1,
        preco: '25.00',
      }),
    ).rejects.toBeInstanceOf(ErroGateway);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
