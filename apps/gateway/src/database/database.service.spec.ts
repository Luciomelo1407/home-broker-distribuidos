import type { Pool } from 'pg';
import { DatabaseService } from './database.service';

function criarPoolFalso(falharEm?: string) {
  const comandos: string[] = [];
  const cliente = {
    query: jest.fn(async (sql: string) => {
      comandos.push(sql);
      if (sql === falharEm) throw new Error(`falhou em ${sql}`);
      return { rows: [] };
    }),
    release: jest.fn(),
  };
  const pool = { connect: jest.fn(async () => cliente) } as unknown as Pool;
  return { pool, cliente, comandos };
}

describe('DatabaseService.transacao', () => {
  it('faz COMMIT e devolve o resultado da função', async () => {
    const { pool, cliente, comandos } = criarPoolFalso();
    const db = new DatabaseService(pool);

    const resultado = await db.transacao(async (c) => {
      await c.query('INSERT 1');
      return 42;
    });

    expect(resultado).toBe(42);
    expect(comandos).toEqual(['BEGIN', 'INSERT 1', 'COMMIT']);
    expect(cliente.release).toHaveBeenCalledWith(undefined);
  });

  it('faz ROLLBACK e relança o erro da função', async () => {
    const { pool, cliente, comandos } = criarPoolFalso('INSERT 2');
    const db = new DatabaseService(pool);

    await expect(
      db.transacao(async (c) => {
        await c.query('INSERT 1');
        await c.query('INSERT 2');
      }),
    ).rejects.toThrow('falhou em INSERT 2');

    expect(comandos).toEqual(['BEGIN', 'INSERT 1', 'INSERT 2', 'ROLLBACK']);
    expect(cliente.release).toHaveBeenCalledWith(undefined);
  });

  it('faz ROLLBACK se o COMMIT falhar', async () => {
    const { pool, comandos } = criarPoolFalso('COMMIT');
    const db = new DatabaseService(pool);

    await expect(db.transacao(async () => 1)).rejects.toThrow('falhou em COMMIT');
    expect(comandos).toEqual(['BEGIN', 'COMMIT', 'ROLLBACK']);
  });

  it('descarta a conexão se o ROLLBACK também falhar, mantendo o erro original', async () => {
    const { pool, cliente } = criarPoolFalso('ROLLBACK');
    const db = new DatabaseService(pool);

    await expect(
      db.transacao(async () => {
        throw new Error('erro da regra');
      }),
    ).rejects.toThrow('erro da regra');

    expect(cliente.release).toHaveBeenCalledWith(expect.any(Error));
  });
});
