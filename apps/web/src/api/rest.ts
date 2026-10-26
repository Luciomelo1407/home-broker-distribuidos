import type {
  AuthCadastroRespostaDto,
  AuthLoginRespostaDto,
  CarteiraRespostaDto,
  CriarOrdemRequisicaoDto,
  HistoricoRespostaDto,
  MercadoRespostaDto,
  OrdemRespostaDto,
  RespostaErroDto,
} from '@bolsa/contracts';
import { urlDoGateway } from './config';

export const TIMEOUT_REQUISICAO_MS = 10_000;

/** Erro da API no formato da arquitetura §4.2, ou falha de rede (`SEM_CONEXAO`). */
export class ErroApi extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
    readonly status: number,
  ) {
    super(mensagem);
    this.name = 'ErroApi';
  }
}

/** Um comando pode ter sido aceito mesmo quando sua resposta não chega ao navegador. */
export function resultadoIncerto(erro: unknown): boolean {
  return !(erro instanceof ErroApi) || erro.status === 0 || erro.status >= 500;
}

/** Uma resposta inesperada nunca deve confirmar silenciosamente um comando financeiro. */
function validarOrdem(
  ordem: OrdemRespostaDto,
  esperado: { clientOrderId?: string; id?: number },
): OrdemRespostaDto {
  if (
    !Number.isSafeInteger(ordem.id) ||
    ordem.id < 1 ||
    typeof ordem.clientOrderId !== 'string' ||
    !['ABERTA', 'PARCIAL', 'EXECUTADA', 'CANCELADA', 'REJEITADA'].includes(ordem.status) ||
    !Number.isSafeInteger(ordem.quantidade) ||
    ordem.quantidade < 1 ||
    !Number.isSafeInteger(ordem.quantidadeExecutada) ||
    ordem.quantidadeExecutada < 0 ||
    ordem.quantidadeExecutada > ordem.quantidade ||
    typeof ordem.precoLimite !== 'string' ||
    (esperado.clientOrderId !== undefined && ordem.clientOrderId !== esperado.clientOrderId) ||
    (esperado.id !== undefined && ordem.id !== esperado.id)
  ) {
    throw new ErroApi(
      'RESPOSTA_INVALIDA',
      'resposta da ordem não reconhecida; consulte o resultado antes de repetir',
      0,
    );
  }
  return ordem;
}

async function chamar<T>(
  caminho: string,
  opcoes: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, ...init } = opcoes;
  const abortar = new AbortController();
  const timer = setTimeout(() => abortar.abort(), TIMEOUT_REQUISICAO_MS);
  try {
    const resposta = await fetch(`${urlDoGateway()}${caminho}`, {
      ...init,
      signal: abortar.signal,
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    const corpo: unknown = await resposta.json().catch(() => undefined);
    if (!resposta.ok) {
      const erro = (corpo as RespostaErroDto | undefined)?.erro;
      throw new ErroApi(
        erro?.codigo ?? 'ERRO_INTERNO',
        erro?.mensagem ?? 'erro inesperado',
        resposta.status,
      );
    }
    if (!corpo || typeof corpo !== 'object') {
      throw new ErroApi(
        'RESPOSTA_INVALIDA',
        'o servidor não devolveu uma resposta válida; consulte o resultado antes de repetir a operação',
        0,
      );
    }
    return corpo as T;
  } catch (erro) {
    if (erro instanceof ErroApi) throw erro;
    throw new ErroApi(
      'SEM_CONEXAO',
      abortar.signal.aborted
        ? 'o servidor demorou a responder; o resultado da operação precisa ser conferido'
        : 'não foi possível falar com o servidor',
      0,
    );
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  cadastrar: (nomeUsuario: string, senha: string) =>
    chamar<AuthCadastroRespostaDto>('/auth/cadastro', {
      method: 'POST',
      body: JSON.stringify({ nomeUsuario, senha }),
    }),
  entrar: (nomeUsuario: string, senha: string) =>
    chamar<AuthLoginRespostaDto>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ nomeUsuario, senha }),
    }),
  carteira: (token: string) => chamar<CarteiraRespostaDto>('/carteira', { token }),
  mercado: () => chamar<MercadoRespostaDto>('/mercado'),
  enviarOrdem: async (token: string, ordem: CriarOrdemRequisicaoDto) =>
    validarOrdem(
      await chamar<OrdemRespostaDto>('/ordens', {
        method: 'POST',
        body: JSON.stringify(ordem),
        token,
      }),
      { clientOrderId: ordem.clientOrderId },
    ),
  cancelarOrdem: async (token: string, id: number) =>
    validarOrdem(await chamar<OrdemRespostaDto>(`/ordens/${id}`, { method: 'DELETE', token }), {
      id,
    }),
  consultarOrdem: async (token: string, id: number) =>
    validarOrdem(await chamar<OrdemRespostaDto>(`/ordens/${id}`, { token }), { id }),
  historico: (token: string) => chamar<HistoricoRespostaDto>('/historico', { token }),
};
