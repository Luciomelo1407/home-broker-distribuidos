import type { EventoMercado, LivroRespostaDto, OrdemResumoDto } from '@bolsa/contracts';
import { randomUUID } from 'node:crypto';
import { ClienteGateway, ErroGateway } from './client/gateway.ts';
import type { Estrategia, VisaoDoMercado } from './estrategias/tipos.ts';

/** Espera entre tentativas quando o Gateway está fora ou recusa o login. */
const ESPERA_RECONEXAO_MS = 3_000;
/** Ordens abertas há mais que isto são canceladas, para o agente não travar saldo à toa. */
const IDADE_MAXIMA_ABERTA_MS = 20_000;

/** Linha de log em JSON, como o resto do sistema (arquitetura §4.3). */
export function log(campos: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), service: 'agents', ...campos }));
}

/**
 * Um agente (RF-019): entra com o próprio usuário, acompanha o mercado pelo WebSocket e,
 * a cada `estrategia.intervaloMs` (±50%), pede uma decisão à estratégia e manda as ordens
 * pelo REST, como um humano faria.
 */
export class Agente {
  private readonly cliente: ClienteGateway;
  private readonly nome: string;
  private readonly senha: string;
  private readonly estrategia: Estrategia;
  private readonly precos: Record<string, string> = {};
  private readonly variacoes: Record<string, string> = {};
  private precosAnteriores: Record<string, string> = {};
  private readonly livros: Record<string, LivroRespostaDto> = {};
  /** Ordens abertas e quando o agente as viu pela primeira vez. */
  private readonly abertas = new Map<number, { ordem: OrdemResumoDto; desde: number }>();
  private ws?: WebSocket;
  private parado = false;
  private timer?: ReturnType<typeof setTimeout>;
  private reconexao?: ReturnType<typeof setTimeout>;
  private inicio?: Promise<void>;
  private rodadaAtual?: Promise<void>;
  private sessao = 0;
  private recebeuSnapshot = false;

  constructor(gatewayUrl: string, nome: string, senha: string, estrategia: Estrategia) {
    this.cliente = new ClienteGateway(gatewayUrl);
    this.nome = nome;
    this.senha = senha;
    this.estrategia = estrategia;
  }

  /** Entra e começa a negociar; tenta de novo sozinho se o Gateway cair. */
  iniciar(): Promise<void> {
    if (this.inicio) return this.inicio;
    if (this.parado || this.ws) return Promise.resolve();
    clearTimeout(this.reconexao);
    this.inicio = this.conectar().finally(() => {
      this.inicio = undefined;
    });
    return this.inicio;
  }

  private async conectar(): Promise<void> {
    while (!this.parado) {
      try {
        await this.cliente.entrar(this.nome, this.senha);
        if (this.parado) return;
        const sessao = ++this.sessao;
        this.ws = this.cliente.abrirEventos(
          (evento) => {
            if (sessao === this.sessao && !this.parado) this.aoEvento(evento);
          },
          (codigo) => {
            if (sessao === this.sessao) this.aoFechar(codigo);
          },
        );
        log({ agente: this.nome, perfil: this.estrategia.perfil, msg: 'agente conectado' });
        this.agendar(sessao);
        return;
      } catch (erro) {
        log({
          level: 'warn',
          agente: this.nome,
          erro: String(erro),
          msg: 'falha ao entrar; tentando de novo',
        });
        await new Promise((r) => setTimeout(r, ESPERA_RECONEXAO_MS));
      }
    }
  }

  parar(): void {
    this.parado = true;
    this.sessao++;
    clearTimeout(this.timer);
    clearTimeout(this.reconexao);
    this.ws?.close();
    this.ws = undefined;
  }

  private aoEvento(evento: EventoMercado): void {
    switch (evento.tipo) {
      case 'SNAPSHOT':
        this.recebeuSnapshot = true;
        for (const ativo of evento.dados.mercado) {
          this.precos[ativo.ativo] = ativo.precoAtual;
          this.variacoes[ativo.ativo] = ativo.variacao;
        }
        this.abertas.clear();
        for (const ordem of evento.dados.ordensAbertas)
          this.abertas.set(ordem.id, { ordem, desde: Date.now() });
        break;
      case 'PRECO':
        this.precos[evento.dados.ativo] = evento.dados.precoAtual;
        this.variacoes[evento.dados.ativo] = evento.dados.variacao;
        break;
      case 'LIVRO':
        this.livros[evento.dados.ativo] = evento.dados;
        break;
      case 'ORDEM_ATUALIZADA': {
        const ordem = evento.dados;
        if (ordem.status === 'ABERTA' || ordem.status === 'PARCIAL') {
          this.abertas.set(ordem.id, {
            ordem,
            desde: this.abertas.get(ordem.id)?.desde ?? Date.now(),
          });
        } else {
          this.abertas.delete(ordem.id);
        }
        break;
      }
      default:
        break;
    }
  }

  private aoFechar(codigo: number): void {
    if (this.parado) return;
    log({ level: 'warn', agente: this.nome, codigo, msg: 'WebSocket fechado; entrando de novo' });
    this.reconectar();
  }

  private reconectar(): void {
    // Invalida callbacks do socket antigo e o finally de uma rodada ainda pendente.
    this.sessao++;
    clearTimeout(this.timer);
    clearTimeout(this.reconexao);
    const ws = this.ws;
    this.ws = undefined;
    this.recebeuSnapshot = false;
    this.precosAnteriores = {};
    for (const ativo of Object.keys(this.livros)) delete this.livros[ativo];
    ws?.close();
    this.reconexao = setTimeout(() => {
      // A rodada anterior termina antes de iniciar outra sessão: não duplica ordens.
      void (this.rodadaAtual ?? Promise.resolve()).then(() => this.iniciar());
    }, ESPERA_RECONEXAO_MS);
  }

  private agendar(sessao: number): void {
    const espera = this.estrategia.intervaloMs * (0.5 + Math.random());
    this.timer = setTimeout(() => {
      this.rodadaAtual = this.rodada(sessao)
        .catch((erro: unknown) => {
          if (sessao !== this.sessao || this.parado) return;
          log({ level: 'warn', agente: this.nome, erro: String(erro), msg: 'rodada falhou' });
          if (erro instanceof ErroGateway && erro.status === 401) this.reconectar();
        })
        .finally(() => {
          if (!this.parado && sessao === this.sessao) this.agendar(sessao);
        });
    }, espera);
  }

  /** Uma decisão: cancela o que envelheceu, pede intenções à estratégia e as envia. */
  private async rodada(sessao: number): Promise<void> {
    if (!this.recebeuSnapshot || Object.keys(this.precos).length === 0) return;
    const agora = Date.now();
    for (const [id, { desde }] of this.abertas) {
      if (agora - desde > IDADE_MAXIMA_ABERTA_MS) {
        await this.cliente.cancelarOrdem(id).catch((erro: unknown) => {
          // Executou ou já foi cancelada nesse meio-tempo: o evento vai tirá-la da lista
          if (!(erro instanceof ErroGateway && erro.status === 409)) throw erro;
        });
        if (sessao !== this.sessao || this.parado) return;
        this.abertas.delete(id);
      }
    }

    const carteira = await this.cliente.carteira();
    if (sessao !== this.sessao || this.parado) return;
    const mercado: VisaoDoMercado = {
      precos: { ...this.precos },
      precosAnteriores: this.precosAnteriores,
      variacoes: { ...this.variacoes },
      livros: this.livros,
    };
    this.precosAnteriores = { ...this.precos };
    const intencoes = this.estrategia.decidir(
      mercado,
      {
        saldoDisponivel: carteira.saldoDisponivel,
        posicoes: carteira.posicoes,
        ordensAbertas: [...this.abertas.values()].map((a) => a.ordem),
      },
      Math.random,
    );
    for (const intencao of intencoes) {
      if (sessao !== this.sessao || this.parado) return;
      const ordem = await this.cliente.enviarOrdem({ clientOrderId: randomUUID(), ...intencao });
      if (sessao !== this.sessao || this.parado) return;
      // RF-020: os logs mostram o comportamento de cada perfil
      log({
        agente: this.nome,
        perfil: this.estrategia.perfil,
        orderId: ordem.id,
        ...intencao,
        status: ordem.status,
        ...(ordem.motivoRejeicao ? { motivo: ordem.motivoRejeicao } : {}),
        msg: 'ordem enviada',
      });
      if (ordem.status === 'ABERTA' || ordem.status === 'PARCIAL') {
        this.abertas.set(ordem.id, { ordem, desde: Date.now() });
      }
    }
  }
}
