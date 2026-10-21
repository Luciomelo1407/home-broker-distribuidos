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

  constructor(gatewayUrl: string, nome: string, senha: string, estrategia: Estrategia) {
    this.cliente = new ClienteGateway(gatewayUrl);
    this.nome = nome;
    this.senha = senha;
    this.estrategia = estrategia;
  }

  /** Entra e começa a negociar; tenta de novo sozinho se o Gateway cair. */
  async iniciar(): Promise<void> {
    while (!this.parado) {
      try {
        await this.cliente.entrar(this.nome, this.senha);
        this.ws = this.cliente.abrirEventos(
          (evento) => this.aoEvento(evento),
          (codigo) => this.aoFechar(codigo),
        );
        log({ agente: this.nome, perfil: this.estrategia.perfil, msg: 'agente conectado' });
        this.agendar();
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
    clearTimeout(this.timer);
    this.ws?.close();
  }

  private aoEvento(evento: EventoMercado): void {
    switch (evento.tipo) {
      case 'SNAPSHOT':
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
    clearTimeout(this.timer);
    if (this.parado) return;
    log({ level: 'warn', agente: this.nome, codigo, msg: 'WebSocket fechado; entrando de novo' });
    setTimeout(() => void this.iniciar(), ESPERA_RECONEXAO_MS);
  }

  private agendar(): void {
    const espera = this.estrategia.intervaloMs * (0.5 + Math.random());
    this.timer = setTimeout(() => {
      this.rodada()
        .catch((erro: unknown) =>
          log({ level: 'warn', agente: this.nome, erro: String(erro), msg: 'rodada falhou' }),
        )
        .finally(() => {
          if (!this.parado) this.agendar();
        });
    }, espera);
  }

  /** Uma decisão: cancela o que envelheceu, pede intenções à estratégia e as envia. */
  private async rodada(): Promise<void> {
    if (Object.keys(this.precos).length === 0) return;
    const agora = Date.now();
    for (const [id, { desde }] of this.abertas) {
      if (agora - desde > IDADE_MAXIMA_ABERTA_MS) {
        await this.cliente.cancelarOrdem(id).catch((erro: unknown) => {
          // Executou ou já foi cancelada nesse meio-tempo: o evento vai tirá-la da lista
          if (!(erro instanceof ErroGateway && erro.status === 409)) throw erro;
        });
        this.abertas.delete(id);
      }
    }

    const carteira = await this.cliente.carteira();
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
      const ordem = await this.cliente.enviarOrdem({ clientOrderId: randomUUID(), ...intencao });
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
