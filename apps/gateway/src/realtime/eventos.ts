import type { EventoMercado, OrdemRespostaDto, ResultadoOrdem } from '@bolsa/contracts';

/** Eventos que um resultado do Motor gera no WebSocket. */
export interface EventosDoResultado {
  /** `ORDEM_ATUALIZADA` de cada ordem, só para o dono dela (RNF-08). */
  porInvestidor: Map<number, EventoMercado[]>;
  /** `NEGOCIO` e `PRECO`: o mercado é o mesmo para todos (RF-018). */
  paraTodos: EventoMercado[];
}

/**
 * RF-018: transforma o `resultado-ordem` publicado pelo Motor nos eventos da tela
 * (docs/integracao.md §1: o Motor publica só o resultado; os eventos saem daqui).
 */
export function eventosDoResultado(resultado: ResultadoOrdem): EventosDoResultado {
  const porInvestidor = new Map<number, EventoMercado[]>();
  for (const ordem of resultado.ordensAtualizadas) {
    const evento: EventoMercado = { tipo: 'ORDEM_ATUALIZADA', dados: resumo(ordem) };
    porInvestidor.set(ordem.investidorId, [
      ...(porInvestidor.get(ordem.investidorId) ?? []),
      evento,
    ]);
  }
  const paraTodos: EventoMercado[] = [
    ...resultado.negocios.map((dados): EventoMercado => ({ tipo: 'NEGOCIO', dados })),
    ...resultado.mercado.map((dados): EventoMercado => ({ tipo: 'PRECO', dados })),
  ];
  return { porInvestidor, paraTodos };
}

/** `ORDEM_ATUALIZADA.dados` não leva `investidorId` (schema evento-mercado). */
function resumo(
  ordem: OrdemRespostaDto,
): Extract<EventoMercado, { tipo: 'ORDEM_ATUALIZADA' }>['dados'] {
  const { id, clientOrderId, ativo, lado, precoLimite, quantidade, quantidadeExecutada, status } =
    ordem;
  const dados = {
    id,
    clientOrderId,
    ativo,
    lado,
    precoLimite,
    quantidade,
    quantidadeExecutada,
    status,
  };
  return ordem.motivoRejeicao ? { ...dados, motivoRejeicao: ordem.motivoRejeicao } : dados;
}
