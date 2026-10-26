// @vitest-environment jsdom
import type { CarteiraRespostaDto, EventoMercado, OrdemRespostaDto } from '@bolsa/contracts';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ErroApi } from '../api/rest';
import type { OuvintesWs } from '../api/ws';
import { ordem, pendente } from '../test/apoio';
import { JANELA_RECARGA_MS, usePainel } from './use-painel';

const { ws } = vi.hoisted(() => ({
  ws: { ouvintes: undefined as OuvintesWs | undefined, fechar: vi.fn() },
}));
vi.mock('../api/ws', () => ({
  conectarWs: (_token: string, ouvintes: OuvintesWs) => {
    ws.ouvintes = ouvintes;
    return ws.fechar;
  },
}));
const sessao = { token: 'ana-token', investidor: { id: 1, nomeUsuario: 'ana' } };
const carteira: CarteiraRespostaDto = {
  saldoDisponivel: '100000.00',
  saldoReservado: '0.00',
  patrimonio: '100000.00',
  lucroPrejuizo: '0.00',
  posicoes: [],
};
const snapshot: EventoMercado = {
  tipo: 'SNAPSHOT',
  dados: {
    saldo: '100000.00',
    posicoes: [],
    ordensAbertas: [],
    mercado: [],
  },
};
beforeEach(() => {
  ws.fechar.mockClear();
  vi.spyOn(api, 'carteira').mockResolvedValue(carteira);
  vi.spyOn(api, 'historico').mockResolvedValue({ ordens: [], negocios: [] });
  vi.spyOn(api, 'mercado').mockResolvedValue({ ativos: [] });
});

describe('integração do painel com REST e eventos', () => {
  it('agrupa rajadas de eventos em uma recarga por recurso a cada 500 ms', async () => {
    vi.useFakeTimers();
    const sair = vi.fn();
    renderHook(() => usePainel(sessao, sair));
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.carteira).toHaveBeenCalledTimes(1);
    act(() => {
      for (let i = 0; i < 50; i++)
        ws.ouvintes?.aoEvento({ tipo: 'ORDEM_ATUALIZADA', dados: ordem() });
    });
    expect(api.carteira).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(JANELA_RECARGA_MS));
    expect(api.carteira).toHaveBeenCalledTimes(2);
    expect(api.historico).toHaveBeenCalledTimes(2);
  });

  it('desmontagem fecha o socket, cancela recargas e ignora a resposta pendente', async () => {
    vi.useFakeTimers();
    const resposta = pendente<CarteiraRespostaDto>();
    vi.mocked(api.carteira).mockReturnValue(resposta.promessa);
    const sair = vi.fn();
    const { unmount } = renderHook(() => usePainel(sessao, sair));
    act(() => ws.ouvintes?.aoEvento(snapshot));
    unmount();
    await act(async () => {
      resposta.resolver(carteira);
      await vi.advanceTimersByTimeAsync(JANELA_RECARGA_MS);
    });
    expect(ws.fechar).toHaveBeenCalledTimes(1);
    expect(api.carteira).toHaveBeenCalledTimes(1);
  });

  it('consulta que confirma cancelamento também atualiza reservas e histórico', async () => {
    vi.useFakeTimers();
    vi.spyOn(api, 'consultarOrdem').mockResolvedValue(ordem({ status: 'CANCELADA' }));
    const sair = vi.fn();
    const { result } = renderHook(() => usePainel(sessao, sair));
    await act(async () => result.current.consultarOrdem(7));
    await act(async () => vi.advanceTimersByTimeAsync(JANELA_RECARGA_MS));
    expect(api.carteira).toHaveBeenCalledTimes(2);
    expect(api.historico).toHaveBeenCalledTimes(2);
    expect(result.current.estado.ordens[0]?.status).toBe('CANCELADA');
  });

  it('sessão expirada em comando encerra o acesso', async () => {
    vi.spyOn(api, 'cancelarOrdem').mockRejectedValue(
      new ErroApi('NAO_AUTENTICADO', 'expirou', 401),
    );
    const sair = vi.fn();
    const { result } = renderHook(() => usePainel(sessao, sair));
    await act(async () => {
      await expect(result.current.cancelarOrdem(7)).rejects.toMatchObject({ status: 401 });
    });
    expect(sair).toHaveBeenCalledTimes(1);
  });

  it('resposta de um comando após logout não reabre dados do investidor', async () => {
    const resposta = pendente<OrdemRespostaDto>();
    vi.spyOn(api, 'cancelarOrdem').mockReturnValue(resposta.promessa);
    const sair = vi.fn();
    const { result, unmount } = renderHook(() => usePainel(sessao, sair));
    const chamada = result.current.cancelarOrdem(7);
    unmount();
    await act(async () => {
      resposta.resolver(ordem({ status: 'CANCELADA' }));
      await chamada;
    });
    expect(sair).not.toHaveBeenCalled();
    expect(api.carteira).toHaveBeenCalledTimes(1);
  });
});
