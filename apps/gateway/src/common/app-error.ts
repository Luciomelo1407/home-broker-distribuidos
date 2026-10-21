/**
 * Códigos de erro da API REST (arquitetura §4.2).
 * ACESSO_NEGADO, NAO_ENCONTRADO e REQUISICAO_INVALIDA não estão na tabela da arquitetura:
 * cobrem exceções que o próprio Nest lança (rota inexistente, corpo grande demais…).
 * ORDEM_NAO_CANCELAVEL (409) também não: é o DELETE /ordens/:id de uma ordem já encerrada.
 */
export const CodigoErro = {
  VALIDACAO: 'VALIDACAO',
  NAO_AUTENTICADO: 'NAO_AUTENTICADO',
  CREDENCIAIS_INVALIDAS: 'CREDENCIAIS_INVALIDAS',
  ORDEM_DE_OUTRO_INVESTIDOR: 'ORDEM_DE_OUTRO_INVESTIDOR',
  USUARIO_JA_EXISTE: 'USUARIO_JA_EXISTE',
  NAO_CONFIRMADA: 'NAO_CONFIRMADA',
  MERCADO_INDISPONIVEL: 'MERCADO_INDISPONIVEL',
  ERRO_INTERNO: 'ERRO_INTERNO',
  ACESSO_NEGADO: 'ACESSO_NEGADO',
  NAO_ENCONTRADO: 'NAO_ENCONTRADO',
  REQUISICAO_INVALIDA: 'REQUISICAO_INVALIDA',
  ORDEM_NAO_CANCELAVEL: 'ORDEM_NAO_CANCELAVEL',
} as const;

export type CodigoErro = (typeof CodigoErro)[keyof typeof CodigoErro];

/**
 * Erro esperado da API. Os services lançam `AppError` e o FiltroDeErros o traduz
 * para `{ erro: { codigo, mensagem, campos? }, requestId }` com o status HTTP dado.
 * A mensagem vai para o cliente, então não pode conter detalhe interno.
 *
 * @example throw new AppError(CodigoErro.USUARIO_JA_EXISTE, 409, 'nome de usuário já cadastrado')
 */
export class AppError extends Error {
  constructor(
    readonly codigo: CodigoErro,
    readonly httpStatus: number,
    mensagem: string,
    readonly campos?: string[],
  ) {
    super(mensagem);
    this.name = 'AppError';
  }
}
