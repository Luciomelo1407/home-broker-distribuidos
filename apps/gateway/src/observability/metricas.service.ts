import { Injectable } from '@nestjs/common';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

/** Como uma ordem enviada ao Motor terminou, do ponto de vista do Gateway. */
export type ResultadoDaOrdem = 'aceita' | 'rejeitada' | 'nao_confirmada' | 'indisponivel' | 'erro';

/**
 * Métricas do Gateway (RF-026), com os nomes da arquitetura §4.3. Cada instância tem o
 * próprio registro, para que vários AppModule no mesmo processo (testes e2e) não colidam.
 * As métricas do Motor são dele (Dev 2) e o Prometheus junta as duas.
 */
@Injectable()
export class MetricasService {
  readonly registro = new Registry();

  /** RF-026: ordens processadas; a taxa por segundo sai de `rate()` no Prometheus. */
  private readonly ordens = new Counter({
    name: 'bolsa_ordens_processadas_total',
    help: 'Ordens enviadas ao Motor, por resultado',
    labelNames: ['resultado'] as const,
    registers: [this.registro],
  });

  /** RF-026/RNF-03: do POST /ordens até a resposta do Motor (p95 com histogram_quantile). */
  private readonly latencia = new Histogram({
    name: 'bolsa_ordem_latencia_segundos',
    help: 'Tempo entre receber a ordem e responder com o resultado do Motor',
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 3],
    registers: [this.registro],
  });

  /** RF-026/RF-003: conexões WebSocket abertas neste Gateway. */
  private readonly conectados = new Gauge({
    name: 'bolsa_clientes_conectados',
    help: 'Conexões WebSocket autenticadas abertas neste Gateway',
    registers: [this.registro],
  });

  /** RF-026: erros por tipo (http_5xx, redis…). */
  private readonly erros = new Counter({
    name: 'bolsa_erros_total',
    help: 'Erros do Gateway, por tipo',
    labelNames: ['tipo'] as const,
    registers: [this.registro],
  });

  constructor() {
    // CPU, memória e event loop do processo: entram no relatório de carga (RNF-04)
    collectDefaultMetrics({ register: this.registro, prefix: 'bolsa_gateway_' });
  }

  ordemProcessada(resultado: ResultadoDaOrdem, segundos: number): void {
    this.ordens.inc({ resultado });
    this.latencia.observe(segundos);
  }

  clienteConectou(): void {
    this.conectados.inc();
  }

  clienteDesconectou(): void {
    this.conectados.dec();
  }

  erro(tipo: string): void {
    this.erros.inc({ tipo });
  }

  /** Texto no formato do Prometheus. */
  expor(): Promise<string> {
    return this.registro.metrics();
  }
}
