import type { ComandoOrdem, ResultadoOrdem } from '@bolsa/contracts';

/** Comando `CRIAR` do stream `orders` (schema `comando-ordem`, docs/integracao.md §2). */
export type ComandoCriarOrdem = Extract<ComandoOrdem, { tipo: 'CRIAR' }>;

/** O Motor não respondeu no prazo. O comando pode ter sido processado (ou não). */
export class ComandoNaoConfirmado extends Error {
  constructor(readonly clientOrderId: string) {
    super(`ordem ${clientOrderId} não confirmada no prazo`);
    this.name = 'ComandoNaoConfirmado';
  }
}

/** O Redis está fora: o comando não chegou ao stream. */
export class BarramentoIndisponivel extends Error {
  constructor(causa?: unknown) {
    super('barramento de ordens indisponível', { cause: causa });
    this.name = 'BarramentoIndisponivel';
  }
}

/**
 * O que o `ordens` precisa do `gateway/bus`: pôr o comando no stream e esperar
 * o resultado com o mesmo `(investidorId, clientOrderId)` (arquitetura §3.1, correlação requisição →
 * resposta assíncrona). O `BusModule` registra a implementação com
 * `{ provide: BarramentoDeOrdens, useExisting: BusService }`.
 *
 * Deve rejeitar com `ComandoNaoConfirmado` quando passar de `timeoutMs` e com
 * `BarramentoIndisponivel` quando o XADD falhar.
 */
export abstract class BarramentoDeOrdens {
  abstract enviarEAguardar(comando: ComandoOrdem, timeoutMs: number): Promise<ResultadoOrdem>;
}
