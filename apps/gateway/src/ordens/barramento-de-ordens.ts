import type { LadoOrdem, OrdemRespostaDto } from '@bolsa/contracts';

/**
 * Comando `CRIAR` do stream `orders` (plano §3.1). O schema `comando-ordem` do
 * `packages/contracts` (Dev 2) é a fonte; este tipo deve espelhá-lo.
 */
export interface ComandoCriarOrdem {
  tipo: 'CRIAR';
  clientOrderId: string;
  investidorId: number;
  ativo: string;
  lado: LadoOrdem;
  quantidade: number;
  preco: string;
}

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
 * O que o `ordens` precisa do `gateway/bus` (Dev 2): pôr o comando no stream e esperar
 * o resultado com o mesmo `clientOrderId` (arquitetura §3.1, correlação requisição →
 * resposta assíncrona). O `BusModule` registra a implementação com
 * `{ provide: BarramentoDeOrdens, useExisting: BusService }`.
 *
 * Deve rejeitar com `ComandoNaoConfirmado` quando passar de `timeoutMs` e com
 * `BarramentoIndisponivel` quando o XADD falhar.
 */
export abstract class BarramentoDeOrdens {
  abstract enviarEAguardar(
    comando: ComandoCriarOrdem,
    timeoutMs: number,
  ): Promise<OrdemRespostaDto>;
}
