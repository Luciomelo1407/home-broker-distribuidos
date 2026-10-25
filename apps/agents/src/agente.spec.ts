import type { EventoMercado } from '@bolsa/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Agente } from './agente.ts';
import { ClienteGateway, ErroGateway } from './client/gateway.ts';
import type { Estrategia } from './estrategias/tipos.ts';

const snapshot: EventoMercado = {
  tipo: 'SNAPSHOT',
  dados: {
    saldo: '100000.00',
    posicoes: [],
    ordensAbertas: [],
    mercado: [{ ativo: 'ABC3', precoAtual: '25.00', variacao: '0.00', volume: 0 }],
  },
};
const carteira = {
  saldoDisponivel: '100000.00',
  saldoReservado: '0.00',
  patrimonio: '100000.00',
  lucroPrejuizo: '0.00',
  posicoes: [],
};
const naoAutenticado = () => new ErroGateway('NAO_AUTENTICADO', 'token inválido', 401);
const login = { token: 'novo-token', investidor: { id: 1, nomeUsuario: 'teste' } };

describe('ciclo do agente', () => {
  let agente: Agente;
  let sockets: {
    evento: (evento: EventoMercado) => void;
    fechar: (codigo: number) => void;
    close: ReturnType<typeof vi.fn>;
  }[];
  let estrategia: Estrategia;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(ClienteGateway.prototype, 'entrar').mockResolvedValue(login);
    vi.spyOn(ClienteGateway.prototype, 'carteira').mockResolvedValue(carteira);
    sockets = [];
    vi.spyOn(ClienteGateway.prototype, 'abrirEventos').mockImplementation((evento, fechar) => {
      const close = vi.fn(() => fechar(1000));
      sockets.push({ evento, fechar, close });
      return { close } as unknown as WebSocket;
    });
    estrategia = { perfil: 'conservador', intervaloMs: 1000, decidir: vi.fn(() => []) };
    agente = new Agente('http://gateway:3001', 'teste', 'senha-teste', estrategia);
  });

  afterEach(() => {
    agente.parar();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('espera o snapshot e impede duas inicializações e duas rodadas simultâneas', async () => {
    await Promise.all([agente.iniciar(), agente.iniciar()]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(ClienteGateway.prototype.entrar).toHaveBeenCalledTimes(1);
    expect(estrategia.decidir).not.toHaveBeenCalled();
    sockets[0]?.evento(snapshot);
    await vi.advanceTimersByTimeAsync(1000);
    expect(estrategia.decidir).toHaveBeenCalledTimes(1);
  });

  it('refaz login após 401, ignora o socket antigo e espera um snapshot novo', async () => {
    vi.mocked(ClienteGateway.prototype.carteira).mockRejectedValueOnce(naoAutenticado());
    await agente.iniciar();
    sockets[0]?.evento(snapshot);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets[0]?.close).toHaveBeenCalledTimes(1);
    sockets[0]?.fechar(4401); // fechamento tardio não cria outra reconexão
    await vi.advanceTimersByTimeAsync(3000);
    expect(ClienteGateway.prototype.entrar).toHaveBeenCalledTimes(2);
    sockets[0]?.evento(snapshot);
    await vi.advanceTimersByTimeAsync(1000);
    expect(estrategia.decidir).not.toHaveBeenCalled();
    sockets[1]?.evento(snapshot);
    await vi.advanceTimersByTimeAsync(1000);
    expect(estrategia.decidir).toHaveBeenCalledTimes(1);
  });

  it.each(['enviarOrdem', 'cancelarOrdem'] as const)(
    'recupera também quando %s recebe 401, sem reenviar a operação antiga',
    async (operacao) => {
      const chamada = vi
        .spyOn(ClienteGateway.prototype, operacao)
        .mockRejectedValueOnce(naoAutenticado());
      if (operacao === 'enviarOrdem') {
        vi.mocked(estrategia.decidir).mockReturnValueOnce([
          { ativo: 'ABC3', lado: 'COMPRA', quantidade: 1, preco: '25.00' },
        ]);
      }
      await agente.iniciar();
      const aberta = {
        id: 10,
        clientOrderId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        ativo: 'ABC3',
        lado: 'COMPRA' as const,
        precoLimite: '25.00',
        quantidade: 1,
        quantidadeExecutada: 0,
        status: 'ABERTA' as const,
      };
      sockets[0]?.evento({
        ...snapshot,
        dados: { ...snapshot.dados, ordensAbertas: operacao === 'cancelarOrdem' ? [aberta] : [] },
      });
      await vi.advanceTimersByTimeAsync(operacao === 'cancelarOrdem' ? 21_000 : 1000);
      await vi.advanceTimersByTimeAsync(3000);
      expect(ClienteGateway.prototype.entrar).toHaveBeenCalledTimes(2);
      sockets[1]?.evento(snapshot);
      await vi.advanceTimersByTimeAsync(1000);
      expect(chamada).toHaveBeenCalledTimes(1);
      expect(estrategia.decidir).toHaveBeenCalled();
    },
  );

  it('não abre outra rodada enquanto a anterior aguarda HTTP, mesmo com queda do socket', async () => {
    let resolver!: (valor: typeof carteira) => void;
    vi.mocked(ClienteGateway.prototype.carteira).mockReturnValueOnce(
      new Promise((resolve) => {
        resolver = resolve;
      }),
    );
    await agente.iniciar();
    sockets[0]?.evento(snapshot);
    await vi.advanceTimersByTimeAsync(1000);
    sockets[0]?.fechar(1006);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ClienteGateway.prototype.entrar).toHaveBeenCalledTimes(1);
    resolver(carteira);
    await vi.advanceTimersByTimeAsync(0);
    expect(ClienteGateway.prototype.entrar).toHaveBeenCalledTimes(2);
    expect(estrategia.decidir).not.toHaveBeenCalled();
    sockets[1]?.evento(snapshot);
    await vi.advanceTimersByTimeAsync(1000);
    expect(estrategia.decidir).toHaveBeenCalledTimes(1);
  });

  it('mantém uma rodada após falha de rede sem fazer login em duplicidade', async () => {
    vi.mocked(ClienteGateway.prototype.carteira).mockRejectedValueOnce(
      new ErroGateway('SEM_CONEXAO', 'sem rede', 0),
    );
    await agente.iniciar();
    sockets[0]?.evento(snapshot);
    await vi.advanceTimersByTimeAsync(2000);
    expect(ClienteGateway.prototype.entrar).toHaveBeenCalledTimes(1);
    expect(estrategia.decidir).toHaveBeenCalledTimes(1);
  });

  it('tenta login novamente após indisponibilidade e cancela a reconexão ao parar', async () => {
    vi.mocked(ClienteGateway.prototype.entrar).mockRejectedValueOnce(new Error('fora do ar'));
    const inicio = agente.iniciar();
    await vi.advanceTimersByTimeAsync(3000);
    await inicio;
    expect(ClienteGateway.prototype.entrar).toHaveBeenCalledTimes(2);
    sockets[0]?.fechar(1006);
    agente.parar();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ClienteGateway.prototype.entrar).toHaveBeenCalledTimes(2);
  });

  it('parar durante login pendente impede abertura de socket e novas rodadas', async () => {
    let resolver!: (valor: typeof login) => void;
    vi.mocked(ClienteGateway.prototype.entrar).mockReturnValueOnce(
      new Promise((resolve) => {
        resolver = resolve;
      }),
    );
    const inicio = agente.iniciar();
    agente.parar();
    resolver(login);
    await inicio;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sockets).toHaveLength(0);
    expect(estrategia.decidir).not.toHaveBeenCalled();
  });
});
