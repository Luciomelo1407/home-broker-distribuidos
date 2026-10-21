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

async function chamar<T>(
  caminho: string,
  opcoes: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, ...init } = opcoes;
  let resposta: Response;
  try {
    resposta = await fetch(`${urlDoGateway()}${caminho}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch {
    // RNF-11: a tela mostra o problema e continua funcionando
    throw new ErroApi('SEM_CONEXAO', 'não foi possível falar com o servidor', 0);
  }
  const corpo: unknown = await resposta.json().catch(() => undefined);
  if (!resposta.ok) {
    const erro = (corpo as RespostaErroDto | undefined)?.erro;
    throw new ErroApi(
      erro?.codigo ?? 'ERRO_INTERNO',
      erro?.mensagem ?? 'erro inesperado',
      resposta.status,
    );
  }
  return corpo as T;
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
  enviarOrdem: (token: string, ordem: CriarOrdemRequisicaoDto) =>
    chamar<OrdemRespostaDto>('/ordens', { method: 'POST', body: JSON.stringify(ordem), token }),
  cancelarOrdem: (token: string, id: number) =>
    chamar<OrdemRespostaDto>(`/ordens/${id}`, { method: 'DELETE', token }),
  historico: (token: string) => chamar<HistoricoRespostaDto>('/historico', { token }),
};
