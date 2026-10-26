import type { CarteiraRespostaDto } from '@bolsa/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ErroApi } from '../api/rest';
import { LeiturasPainel } from './leituras';

function adiada<T>() {
  let resolver!: (valor: T) => void;
  const promessa = new Promise<T>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}
const carteira: CarteiraRespostaDto = {
  saldoDisponivel: '1.00',
  saldoReservado: '0.00',
  patrimonio: '1.00',
  lucroPrejuizo: '0.00',
  posicoes: [],
};
const cliente = () => ({
  carteira: vi.fn(async () => carteira),
  historico: vi.fn(async () => ({ ordens: [], negocios: [] })),
  mercado: vi.fn(async () => ({ ativos: [] })),
});

describe('leituras por sessão', () => {
  it('resposta mais antiga não substitui a mais recente', async () => {
    const antigo = adiada<CarteiraRespostaDto>();
    const api = cliente();
    api.carteira.mockImplementationOnce(() => antigo.promessa);
    const emitir = vi.fn();
    const leituras = new LeiturasPainel('token', emitir, vi.fn(), api);
    const primeira = leituras.carteira();
    await leituras.carteira();
    antigo.resolver({ ...carteira, saldoDisponivel: '0.00' });
    await primeira;
    expect(emitir).toHaveBeenCalledTimes(1);
    expect(emitir.mock.calls[0]?.[0].carteira.saldoDisponivel).toBe('1.00');
  });
  it('cancelamento da sessão descarta resposta privada pendente', async () => {
    const espera = adiada<CarteiraRespostaDto>();
    const api = cliente();
    api.carteira.mockImplementation(() => espera.promessa);
    const emitir = vi.fn();
    const leituras = new LeiturasPainel('token-antigo', emitir, vi.fn(), api);
    const pendente = leituras.carteira();
    leituras.cancelar();
    espera.resolver(carteira);
    await pendente;
    expect(emitir).not.toHaveBeenCalled();
  });
  it('401 encerra a sessão e os demais resultados são descartados', async () => {
    const api = cliente();
    api.carteira.mockRejectedValue(new ErroApi('NAO_AUTENTICADO', 'expirou', 401));
    const perder = vi.fn();
    const emitir = vi.fn();
    const leituras = new LeiturasPainel('token', emitir, perder, api);
    await leituras.carteira();
    await leituras.historico();
    expect(perder).toHaveBeenCalledOnce();
    expect(emitir).not.toHaveBeenCalled();
  });
  it('falhas de leitura são mostradas, sem substituir dados por zeros', async () => {
    const api = cliente();
    api.carteira.mockRejectedValue(new ErroApi('SEM_CONEXAO', 'rede', 0));
    const emitir = vi.fn();
    await new LeiturasPainel('token', emitir, vi.fn(), api).carteira();
    expect(emitir).toHaveBeenCalledWith({
      tipo: 'FALHA_LEITURA',
      fonte: 'carteira',
      mensagem: 'rede',
    });
  });
});
