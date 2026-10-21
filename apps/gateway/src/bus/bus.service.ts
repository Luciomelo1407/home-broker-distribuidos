import type { ComandoOrdem, ResultadoOrdem } from '@bolsa/contracts';
import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { Subject } from 'rxjs';
import {
  BarramentoDeOrdens,
  BarramentoIndisponivel,
  ComandoNaoConfirmado,
} from '../ordens/barramento-de-ordens';

/** Nomes no Redis (docs/integracao.md §1). O Motor usa os mesmos. */
export const STREAM_ORDENS = 'orders';
export const CANAL_RESULTADO = 'ordens.resultado';

/** Conexão para comandos (XADD, presença). Falha rápido se o Redis estiver fora. */
export const REDIS_COMANDOS = Symbol('REDIS_COMANDOS');
/** Conexão só para SUBSCRIBE: em modo de assinatura ela não aceita outros comandos. */
export const REDIS_ASSINATURA = Symbol('REDIS_ASSINATURA');

interface Espera {
  resolver: (resultado: ResultadoOrdem) => void;
  rejeitar: (erro: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * Os dois lados do Redis no Gateway (arquitetura §3.1, correlação requisição → resposta
 * assíncrona): põe comandos no stream `orders` e assina `ordens.resultado`. Cada resultado
 * resolve quem o espera e segue para `resultados$`, de onde o `realtime` tira os eventos.
 */
@Injectable()
export class BusService extends BarramentoDeOrdens implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(BusService.name);
  private readonly esperas = new Map<string, Espera[]>();
  private readonly resultados = new Subject<ResultadoOrdem>();

  /** Todo resultado publicado pelo Motor, de qualquer investidor. */
  readonly resultados$ = this.resultados.asObservable();

  constructor(
    @Inject(REDIS_COMANDOS) private readonly comandos: Redis,
    @Inject(REDIS_ASSINATURA) private readonly assinatura: Redis,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    this.assinatura.on('message', (canal: string, mensagem: string) => {
      if (canal === CANAL_RESULTADO) this.receber(mensagem);
    });
    await this.assinatura.subscribe(CANAL_RESULTADO);
  }

  async onApplicationShutdown(): Promise<void> {
    for (const lista of this.esperas.values()) {
      for (const espera of lista) clearTimeout(espera.timer);
    }
    this.esperas.clear();
    this.resultados.complete();
    await Promise.allSettled([this.assinatura.quit(), this.comandos.quit()]);
  }

  /**
   * Põe o comando no stream e espera o resultado com o mesmo `(investidorId,
   * clientOrderId)`. A espera é registrada antes do XADD, para não perder um resultado
   * que chegue mais rápido que a resposta do próprio XADD.
   */
  enviarEAguardar(comando: ComandoOrdem, timeoutMs: number): Promise<ResultadoOrdem> {
    const chave = chaveDe(comando.investidorId, comando.clientOrderId);
    return new Promise<ResultadoOrdem>((resolver, rejeitar) => {
      const espera: Espera = {
        resolver,
        rejeitar,
        timer: setTimeout(() => {
          this.remover(chave, espera);
          rejeitar(new ComandoNaoConfirmado(comando.clientOrderId));
        }, timeoutMs),
      };
      this.esperas.set(chave, [...(this.esperas.get(chave) ?? []), espera]);

      this.comandos
        .xadd(STREAM_ORDENS, '*', 'payload', JSON.stringify(comando))
        .catch((erro: unknown) => {
          clearTimeout(espera.timer);
          this.remover(chave, espera);
          rejeitar(new BarramentoIndisponivel(erro));
        });
    });
  }

  private receber(mensagem: string): void {
    let resultado: ResultadoOrdem;
    try {
      resultado = JSON.parse(mensagem) as ResultadoOrdem;
    } catch {
      this.logger.error('resultado do Motor não é JSON; ignorado');
      return;
    }
    if (
      typeof resultado?.clientOrderId !== 'string' ||
      typeof resultado.investidorId !== 'number'
    ) {
      this.logger.error('resultado do Motor sem clientOrderId/investidorId; ignorado');
      return;
    }

    const chave = chaveDe(resultado.investidorId, resultado.clientOrderId);
    for (const espera of this.esperas.get(chave) ?? []) {
      clearTimeout(espera.timer);
      espera.resolver(resultado);
    }
    this.esperas.delete(chave);
    this.resultados.next(resultado);
  }

  private remover(chave: string, espera: Espera): void {
    const restantes = (this.esperas.get(chave) ?? []).filter((e) => e !== espera);
    if (restantes.length > 0) this.esperas.set(chave, restantes);
    else this.esperas.delete(chave);
  }
}

function chaveDe(investidorId: number, clientOrderId: string): string {
  return `${investidorId}:${clientOrderId.toLowerCase()}`;
}
