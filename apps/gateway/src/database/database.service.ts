import { Inject, Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import type { Pool, QueryResult, QueryResultRow } from 'pg';

export const PG_POOL = Symbol('PG_POOL');

/**
 * O que um arquivo `*.queries.ts` precisa para rodar SQL. Tanto o DatabaseService quanto
 * o cliente recebido dentro de `transacao()` atendem a esta interface, então a mesma
 * função de consulta serve dentro e fora de uma transação.
 */
export interface Executor {
  query<R extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<R>>;
}

/**
 * Acesso ao Postgres com o papel `gateway_app`, que só tem SELECT e o INSERT do cadastro
 * (arquitetura §2). Qualquer UPDATE de saldo feito daqui é recusado pelo banco.
 */
@Injectable()
export class DatabaseService implements Executor, OnModuleInit, OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Falha ao subir se o banco estiver inacessível ou a senha estiver errada. */
  async onModuleInit(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }

  /** Executa uma consulta fora de transação, com parâmetros posicionais ($1, $2…). */
  query<R extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<R>> {
    return this.pool.query<R>(sql, params);
  }

  /**
   * Roda `fn` numa transação: COMMIT se ela terminar, ROLLBACK se lançar (e o erro é
   * relançado). Use o `cliente` recebido em todas as consultas que fazem parte dela.
   *
   * @example
   * await db.transacao(async (cliente) => {
   *   const id = await inserirInvestidor(cliente, dados);
   *   await inserirPosicoesIniciais(cliente, id);
   * });
   */
  async transacao<T>(fn: (cliente: Executor) => Promise<T>): Promise<T> {
    const cliente = await this.pool.connect();
    // Se nem o ROLLBACK funcionar, a conexão está quebrada e não pode voltar ao pool
    let conexaoQuebrada: Error | undefined;
    try {
      await cliente.query('BEGIN');
      const resultado = await fn(cliente);
      await cliente.query('COMMIT');
      return resultado;
    } catch (erro) {
      try {
        await cliente.query('ROLLBACK');
      } catch (erroRollback) {
        conexaoQuebrada =
          erroRollback instanceof Error ? erroRollback : new Error(String(erroRollback));
      }
      throw erro;
    } finally {
      cliente.release(conexaoQuebrada);
    }
  }
}
