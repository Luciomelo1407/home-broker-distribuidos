import type {
  AuthLoginRespostaDto,
  CarteiraRespostaDto,
  CriarOrdemRequisicaoDto,
  EventoMercado,
  OrdemRespostaDto,
  RespostaErroDto,
} from '@bolsa/contracts';

/** Erro da API (arquitetura §4.2) ou de rede (`SEM_CONEXAO`). */
export class ErroGateway extends Error {
  readonly codigo: string;
  readonly status: number;

  constructor(codigo: string, mensagem: string, status: number) {
    super(mensagem);
    this.name = 'ErroGateway';
    this.codigo = codigo;
    this.status = status;
  }
}

/**
 * Cliente do Gateway para um agente: a mesma API REST e WebSocket dos humanos (RF-019).
 * Usa o `fetch` e o `WebSocket` nativos do Node 24, sem dependências.
 */
export class ClienteGateway {
  private token = '';
  private readonly url: string;

  constructor(url: string) {
    this.url = url;
  }

  async entrar(nomeUsuario: string, senha: string): Promise<AuthLoginRespostaDto> {
    const login = await this.chamar<AuthLoginRespostaDto>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ nomeUsuario, senha }),
    });
    this.token = login.token;
    return login;
  }

  carteira(): Promise<CarteiraRespostaDto> {
    return this.chamar('/carteira');
  }

  enviarOrdem(ordem: CriarOrdemRequisicaoDto): Promise<OrdemRespostaDto> {
    return this.chamar('/ordens', { method: 'POST', body: JSON.stringify(ordem) });
  }

  cancelarOrdem(id: number): Promise<OrdemRespostaDto> {
    return this.chamar(`/ordens/${id}`, { method: 'DELETE' });
  }

  /** Abre o WebSocket; `aoFechar` recebe o código de fechamento. */
  abrirEventos(
    aoEvento: (evento: EventoMercado) => void,
    aoFechar: (codigo: number) => void,
  ): WebSocket {
    const ws = new WebSocket(
      `${this.url.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(this.token)}`,
    );
    ws.addEventListener('message', (mensagem) => {
      try {
        aoEvento(JSON.parse(String(mensagem.data)) as EventoMercado);
      } catch {
        // Mensagem fora do contrato: ignorada
      }
    });
    ws.addEventListener('close', (fechamento) => aoFechar(fechamento.code));
    return ws;
  }

  private async chamar<T>(caminho: string, init: RequestInit = {}): Promise<T> {
    let resposta: Response;
    try {
      resposta = await fetch(`${this.url}${caminho}`, {
        ...init,
        headers: {
          'content-type': 'application/json',
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        },
      });
    } catch {
      throw new ErroGateway('SEM_CONEXAO', `Gateway inacessível em ${this.url}`, 0);
    }
    const corpo: unknown = await resposta.json().catch(() => undefined);
    if (!resposta.ok) {
      const erro = (corpo as RespostaErroDto | undefined)?.erro;
      throw new ErroGateway(
        erro?.codigo ?? 'ERRO_INTERNO',
        erro?.mensagem ?? 'erro inesperado',
        resposta.status,
      );
    }
    return corpo as T;
  }
}
