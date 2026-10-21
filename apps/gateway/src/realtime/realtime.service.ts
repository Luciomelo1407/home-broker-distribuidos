import type { EventoMercado } from '@bolsa/contracts';
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Subscription } from 'rxjs';
import { WebSocket, WebSocketServer } from 'ws';
import { AuthService } from '../auth/auth.service';
import { BusService, CHAVE_BATIMENTO, REDIS_COMANDOS } from '../bus/bus.service';
import { CarteiraService } from '../carteira/carteira.service';
import { LivroService } from '../mercado/livro.service';
import { MetricasService } from '../observability/metricas.service';
import { MercadoService } from '../mercado/mercado.service';
import { eventosDoResultado } from './eventos';
import { Presenca } from './presenca';

export const CAMINHO_WS = '/ws';
/** RF-023: ping a cada 5 s; quem não responde a um ping é desconectado no seguinte. */
export const INTERVALO_PING_MS = 5_000;
/** Com que frequência o Gateway confere se o Motor está vivo (CA-05). */
export const INTERVALO_BATIMENTO_MS = 1_000;
/** Código de fechamento para token ausente ou inválido (faixa 4000-4999 é da aplicação). */
export const FECHAMENTO_NAO_AUTENTICADO = 4401;

const MOTOR_FORA: EventoMercado = {
  tipo: 'ERRO',
  dados: {
    codigo: 'MERCADO_INDISPONIVEL',
    mensagem: 'mercado temporariamente indisponível; suas ordens abertas estão preservadas',
  },
};

interface Conexao {
  id: string;
  investidorId: number;
  respondeuPing: boolean;
  /** Eventos que chegaram antes do SNAPSHOT; `undefined` depois que ele foi enviado. */
  pendentes?: EventoMercado[];
}

/**
 * WebSocket do Home Broker (RF-003, RF-004, RF-018, RF-023). O token vai na URL
 * (`/ws?token=<jwt>`), porque o navegador não deixa pôr header no WebSocket. Ao abrir:
 * autentica, manda o SNAPSHOT e passa a repassar os eventos derivados dos resultados
 * do Motor.
 *
 * Usa o `ws` direto sobre o servidor HTTP do Nest, sem `@nestjs/websockets`, para que a
 * autenticação aconteça na abertura e os testes não precisem configurar um adapter.
 */
@Injectable()
export class RealtimeService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly conexoes = new Map<WebSocket, Conexao>();
  private readonly presenca: Presenca;
  private wss?: WebSocketServer;
  private ping?: NodeJS.Timeout;
  private batimento?: NodeJS.Timeout;
  /** Último estado visto do Motor; `undefined` antes da primeira conferência. */
  private motorNoAr?: boolean;
  private readonly redis: Redis;
  private readonly assinaturas: Subscription[] = [];
  private ultimoTotal = -1;

  constructor(
    private readonly http: HttpAdapterHost,
    private readonly auth: AuthService,
    private readonly bus: BusService,
    private readonly carteira: CarteiraService,
    private readonly mercado: MercadoService,
    private readonly livros: LivroService,
    private readonly metricas: MetricasService,
    @Inject(REDIS_COMANDOS) redis: Redis,
  ) {
    this.presenca = new Presenca(redis);
    this.redis = redis;
  }

  onApplicationBootstrap(): void {
    const servidor = this.http.httpAdapter.getHttpServer() as Server;
    this.wss = new WebSocketServer({ server: servidor, path: CAMINHO_WS });
    this.wss.on('connection', (socket, req) => {
      this.abrir(socket, req).catch((erro: unknown) => {
        this.logger.error({ erro: String(erro) }, 'falha ao abrir conexão WebSocket');
        socket.close(1011, 'erro interno');
      });
    });
    this.assinaturas.push(
      this.bus.resultados$.subscribe((resultado) => {
        const { porInvestidor, paraTodos } = eventosDoResultado(resultado);
        for (const [socket, conexao] of this.conexoes) {
          for (const evento of [...(porInvestidor.get(conexao.investidorId) ?? []), ...paraTodos]) {
            this.enviar(socket, conexao, evento);
          }
        }
      }),
      // RF-007: livro novo para todos quando uma ordem do ativo muda
      this.livros.livros$.subscribe((dados) => {
        for (const [socket, conexao] of this.conexoes) {
          this.enviar(socket, conexao, { tipo: 'LIVRO', dados });
        }
      }),
    );
    this.ping = setInterval(() => void this.verificarConexoes(), INTERVALO_PING_MS);
    this.batimento = setInterval(() => void this.verificarMotor(), INTERVALO_BATIMENTO_MS);
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.ping);
    clearInterval(this.batimento);
    for (const assinatura of this.assinaturas) assinatura.unsubscribe();
    await Promise.allSettled([...this.conexoes.values()].map((c) => this.presenca.remover(c.id)));
    for (const socket of this.conexoes.keys()) socket.terminate();
    this.conexoes.clear();
    await new Promise<void>((pronto) => (this.wss ? this.wss.close(() => pronto()) : pronto()));
  }

  private async abrir(socket: WebSocket, req: IncomingMessage): Promise<void> {
    const token = new URL(req.url ?? '', 'http://ws').searchParams.get('token') ?? undefined;
    const usuario = await this.auth.verificar(token);
    if (!usuario) {
      // T-12: WebSocket sem token válido é recusado
      socket.send(
        JSON.stringify({
          tipo: 'ERRO',
          dados: { codigo: 'NAO_AUTENTICADO', mensagem: 'token ausente ou inválido' },
        } satisfies EventoMercado),
      );
      socket.close(FECHAMENTO_NAO_AUTENTICADO, 'NAO_AUTENTICADO');
      return;
    }

    const conexao: Conexao = {
      id: randomUUID(),
      investidorId: usuario.id,
      respondeuPing: true,
      pendentes: [],
    };
    this.conexoes.set(socket, conexao);
    this.metricas.clienteConectou();
    socket.on('pong', () => {
      conexao.respondeuPing = true;
      this.presenca.renovar(conexao.id).catch((erro: unknown) => this.avisarRedis(erro));
    });
    socket.on('close', () => void this.fechar(socket, conexao));
    // Mensagens do cliente são ignoradas: ordens vão pelo REST (POST /ordens)
    socket.on('error', (erro) => this.logger.warn({ erro: erro.message }, 'erro no WebSocket'));

    await this.presenca.renovar(conexao.id).catch((erro: unknown) => this.avisarRedis(erro));
    this.logger.log({ userId: usuario.id, conexao: conexao.id }, 'cliente conectado');

    // RF-004: estado completo na abertura (e em toda reconexão)
    const snapshot = await this.montarSnapshot(usuario.id);
    const pendentes = conexao.pendentes ?? [];
    conexao.pendentes = undefined;
    this.enviar(socket, conexao, snapshot);
    // O SNAPSHOT não tem livro (schema): vai um LIVRO por ativo logo em seguida
    for (const dados of this.livros.todos()) this.enviar(socket, conexao, { tipo: 'LIVRO', dados });
    for (const evento of pendentes) this.enviar(socket, conexao, evento);
    if (this.motorNoAr === false) this.enviar(socket, conexao, MOTOR_FORA);
    await this.difundirPresenca();
  }

  /** Saldo, posições, ordens abertas e mercado do investidor (RF-004). */
  private async montarSnapshot(investidorId: number): Promise<EventoMercado> {
    const [carteira, ordensAbertas] = await Promise.all([
      this.carteira.carteira(investidorId),
      this.carteira.ordensAbertas(investidorId),
    ]);
    return {
      tipo: 'SNAPSHOT',
      dados: {
        saldo: carteira.saldoDisponivel,
        // O SNAPSHOT leva só a posição em si (schema evento-mercado); valor e P/L ficam no REST
        posicoes: carteira.posicoes.map(
          ({ ativo, quantidadeDisponivel, quantidadeReservada, precoMedio }) => ({
            ativo,
            quantidadeDisponivel,
            quantidadeReservada,
            precoMedio,
          }),
        ),
        ordensAbertas,
        mercado: this.mercado.resumo(),
      },
    };
  }

  /**
   * CA-05 (system design §5.3): o Gateway e os WebSockets continuam de pé quando o Motor
   * cai, e os clientes são avisados. Sem batimento (`motor:heartbeat` expira em 5 s), todos
   * recebem `ERRO MERCADO_INDISPONIVEL`. Quando ele volta, mercado e livro são relidos do
   * banco e cada conexão recebe um SNAPSHOT novo, que tira o aviso da tela (RF-004).
   */
  private async verificarMotor(): Promise<void> {
    let noAr: boolean;
    try {
      noAr = (await this.redis.exists(CHAVE_BATIMENTO)) === 1;
    } catch {
      // Sem Redis também não há mercado: as ordens não chegam ao Motor
      noAr = false;
    }
    const antes = this.motorNoAr;
    this.motorNoAr = noAr;
    if (antes === undefined || antes === noAr) return;

    if (!noAr) {
      this.logger.warn(
        { conexoes: this.conexoes.size },
        'Motor sem batimento: mercado indisponível',
      );
      for (const [socket, conexao] of this.conexoes) this.enviar(socket, conexao, MOTOR_FORA);
      return;
    }
    this.logger.log({ conexoes: this.conexoes.size }, 'Motor de volta: reenviando SNAPSHOT');
    await Promise.all([this.mercado.recarregar(), this.livros.recarregar()]);
    for (const [socket, conexao] of this.conexoes) {
      const snapshot = await this.montarSnapshot(conexao.investidorId);
      this.enviar(socket, conexao, snapshot);
      for (const dados of this.livros.todos())
        this.enviar(socket, conexao, { tipo: 'LIVRO', dados });
    }
  }

  private async fechar(socket: WebSocket, conexao: Conexao): Promise<void> {
    if (!this.conexoes.delete(socket)) return;
    this.metricas.clienteDesconectou();
    this.logger.log({ userId: conexao.investidorId, conexao: conexao.id }, 'cliente desconectado');
    await this.presenca.remover(conexao.id).catch((erro: unknown) => this.avisarRedis(erro));
    await this.difundirPresenca();
  }

  /** RF-023: derruba quem não respondeu ao último ping e manda o próximo. */
  private async verificarConexoes(): Promise<void> {
    for (const [socket, conexao] of this.conexoes) {
      if (!conexao.respondeuPing) {
        socket.terminate();
        continue;
      }
      conexao.respondeuPing = false;
      socket.ping();
    }
    // Conexões de outras réplicas também entram e saem; só difunde se o total mudou
    await this.difundirPresenca(true);
  }

  /** RF-003: total de conectados para todos. */
  private async difundirPresenca(soSeMudou = false): Promise<void> {
    let conectados: number;
    try {
      conectados = await this.presenca.contar();
    } catch (erro) {
      this.avisarRedis(erro);
      return;
    }
    if (soSeMudou && conectados === this.ultimoTotal) return;
    this.ultimoTotal = conectados;
    const evento: EventoMercado = { tipo: 'PRESENCA', dados: { conectados } };
    for (const [socket, conexao] of this.conexoes) this.enviar(socket, conexao, evento);
  }

  private enviar(socket: WebSocket, conexao: Conexao, evento: EventoMercado): void {
    if (conexao.pendentes && evento.tipo !== 'SNAPSHOT') {
      conexao.pendentes.push(evento);
      return;
    }
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(evento));
  }

  private avisarRedis(erro: unknown): void {
    this.logger.warn({ erro: String(erro) }, 'presença indisponível no Redis');
  }
}
