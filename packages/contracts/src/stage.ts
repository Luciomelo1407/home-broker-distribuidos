// Estágios de uma ordem.
export const StageOrdem = {
  ORDER_RECEIVED: 'ORDER_RECEIVED',
  ORDER_VALIDATED: 'ORDER_VALIDATED',
  ORDER_BOOK_INSERTED: 'ORDER_BOOK_INSERTED',
  MATCH_FOUND: 'MATCH_FOUND',
  TRADE_EXECUTED: 'TRADE_EXECUTED',
  PORTFOLIO_UPDATED: 'PORTFOLIO_UPDATED',
  CLIENTS_NOTIFIED: 'CLIENTS_NOTIFIED',
  ORDER_REJECTED: 'ORDER_REJECTED',
} as const;

export type StageOrdem = (typeof StageOrdem)[keyof typeof StageOrdem];

// Motivos de rejeição de regras.
export const MotivoRejeicao = {
  SALDO_INSUFICIENTE: 'SALDO_INSUFICIENTE',
  ACOES_INSUFICIENTES: 'ACOES_INSUFICIENTES',
  ATIVO_INEXISTENTE: 'ATIVO_INEXISTENTE',
  ORDEM_NAO_ENCONTRADA: 'ORDEM_NAO_ENCONTRADA',
  ORDEM_DE_OUTRO_INVESTIDOR: 'ORDEM_DE_OUTRO_INVESTIDOR',
  ORDEM_NAO_CANCELAVEL: 'ORDEM_NAO_CANCELAVEL',
  COMANDO_EXPIRADO: 'COMANDO_EXPIRADO',
} as const;

export type MotivoRejeicao = (typeof MotivoRejeicao)[keyof typeof MotivoRejeicao];

export const StatusOrdem = {
  ABERTA: 'ABERTA',
  PARCIAL: 'PARCIAL',
  EXECUTADA: 'EXECUTADA',
  CANCELADA: 'CANCELADA',
  REJEITADA: 'REJEITADA',
} as const;

export type StatusOrdem = (typeof StatusOrdem)[keyof typeof StatusOrdem];

export const LadoOrdem = {
  COMPRA: 'COMPRA',
  VENDA: 'VENDA',
} as const;

export type LadoOrdem = (typeof LadoOrdem)[keyof typeof LadoOrdem];
