import type { Redis } from 'ioredis';

/** ZSET de conexões vivas: membro = id da conexão, score = quando ela expira (ms). */
export const CHAVE_PRESENCA = 'presenca';
/** RF-023: sem ping por 10 s, a conexão deixa de contar como conectada. */
export const PRESENCA_TTL_MS = 10_000;

/**
 * Presença compartilhada por todas as réplicas do Gateway (docs/integracao.md §1).
 * Equivale a uma chave com TTL de 10 s por conexão, mas a contagem sai de um ZCARD.
 */
export class Presenca {
  constructor(
    private readonly redis: Redis,
    private readonly agora: () => number = Date.now,
  ) {}

  /** Registra ou renova a conexão por mais 10 s. */
  async renovar(conexaoId: string): Promise<void> {
    await this.redis.zadd(CHAVE_PRESENCA, this.agora() + PRESENCA_TTL_MS, conexaoId);
  }

  async remover(conexaoId: string): Promise<void> {
    await this.redis.zrem(CHAVE_PRESENCA, conexaoId);
  }

  /** RF-003: quantos estão conectados agora, em todos os Gateways. */
  async contar(): Promise<number> {
    // Limpa as vencidas e conta na mesma transação, para não contar quem já expirou
    const respostas = await this.redis
      .multi()
      .zremrangebyscore(CHAVE_PRESENCA, '-inf', this.agora())
      .zcard(CHAVE_PRESENCA)
      .exec();
    const [erro, total] = respostas?.[1] ?? [new Error('MULTI da presença foi abortado'), 0];
    if (erro) throw erro;
    return Number(total);
  }
}
