import type { OrdemRespostaDto, ResultadoOrdem } from '@bolsa/contracts';
import { eventosDoResultado } from './eventos';

function ordem(
  id: number,
  investidorId: number,
  status: OrdemRespostaDto['status'],
): OrdemRespostaDto {
  return {
    id,
    clientOrderId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    investidorId,
    ativo: 'DEF4',
    lado: 'COMPRA',
    precoLimite: '102.00',
    quantidade: 100,
    quantidadeExecutada: status === 'ABERTA' ? 0 : 100,
    status,
  };
}

const vazio: ResultadoOrdem = {
  clientOrderId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  investidorId: 4,
  ordem: null,
  motivoRejeicao: 'ORDEM_NAO_ENCONTRADA',
  ordensAtualizadas: [],
  negocios: [],
  mercado: [],
};

describe('eventosDoResultado', () => {
  it('manda cada ORDEM_ATUALIZADA só para o dono, sem o investidorId', () => {
    const { porInvestidor } = eventosDoResultado({
      ...vazio,
      ordensAtualizadas: [ordem(51, 4, 'EXECUTADA'), ordem(17, 1, 'EXECUTADA')],
    });

    expect([...porInvestidor.keys()]).toEqual([4, 1]);
    const evento = porInvestidor.get(1)?.[0];
    expect(evento).toMatchObject({ tipo: 'ORDEM_ATUALIZADA', dados: { id: 17 } });
    expect(evento?.dados).not.toHaveProperty('investidorId');
  });

  it('manda NEGOCIO e PRECO para todos', () => {
    const negocio = { id: 9, ativo: 'DEF4', preco: '102.00', quantidade: 100, momento: 'x' };
    const preco = { ativo: 'DEF4', precoAtual: '102.00', variacao: '2.00', volume: 100 };

    const { paraTodos } = eventosDoResultado({ ...vazio, negocios: [negocio], mercado: [preco] });

    expect(paraTodos).toEqual([
      { tipo: 'NEGOCIO', dados: negocio },
      { tipo: 'PRECO', dados: preco },
    ]);
  });

  it('não gera nada para um comando recusado sem ordem', () => {
    const { porInvestidor, paraTodos } = eventosDoResultado(vazio);

    expect(porInvestidor.size).toBe(0);
    expect(paraTodos).toEqual([]);
  });
});
