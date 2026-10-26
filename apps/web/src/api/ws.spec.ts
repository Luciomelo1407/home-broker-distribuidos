import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { conectarWs, INTERVALO_RECONEXAO_MS } from './ws';

class SocketFalso {
  static instancias: SocketFalso[] = [];
  onopen?: () => void;
  onmessage?: (mensagem: { data: string }) => void;
  onclose?: (fechamento: { code: number }) => void;
  constructor(readonly url: string) {
    SocketFalso.instancias.push(this);
  }
  close() {
    this.onclose?.({ code: 1000 });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', SocketFalso);
  vi.stubEnv('NEXT_PUBLIC_GATEWAY_URL', 'http://localhost:3001');
  SocketFalso.instancias = [];
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const ouvintes = () => ({ aoEvento: vi.fn(), aoMudarConexao: vi.fn(), aoRecusarToken: vi.fn() });

describe('reconexão do Home Broker', () => {
  it('só anuncia sincronização depois de aplicar o snapshot', () => {
    const eventos = ouvintes();
    const fechar = conectarWs('token', eventos);
    const socket = SocketFalso.instancias[0]!;
    socket.onopen?.();
    expect(eventos.aoMudarConexao).not.toHaveBeenCalledWith(true);
    socket.onmessage?.({
      data: JSON.stringify({
        tipo: 'SNAPSHOT',
        dados: { saldo: '0.00', posicoes: [], ordensAbertas: [], mercado: [] },
      }),
    });
    expect(eventos.aoEvento).toHaveBeenCalledOnce();
    expect(eventos.aoMudarConexao).toHaveBeenLastCalledWith(true);
    fechar();
  });
  it('queda reconecta uma vez e sair impede novas tentativas', async () => {
    const eventos = ouvintes();
    const fechar = conectarWs('token', eventos);
    SocketFalso.instancias[0]!.onclose?.({ code: 1006 });
    await vi.advanceTimersByTimeAsync(INTERVALO_RECONEXAO_MS);
    expect(SocketFalso.instancias).toHaveLength(2);
    fechar();
    await vi.advanceTimersByTimeAsync(INTERVALO_RECONEXAO_MS * 2);
    expect(SocketFalso.instancias).toHaveLength(2);
  });
  it('4401 encerra a sessão sem tentar reconectar', async () => {
    const eventos = ouvintes();
    const fechar = conectarWs('token', eventos);
    SocketFalso.instancias[0]!.onclose?.({ code: 4401 });
    await vi.advanceTimersByTimeAsync(INTERVALO_RECONEXAO_MS);
    expect(eventos.aoRecusarToken).toHaveBeenCalledOnce();
    expect(SocketFalso.instancias).toHaveLength(1);
    fechar();
  });
});
