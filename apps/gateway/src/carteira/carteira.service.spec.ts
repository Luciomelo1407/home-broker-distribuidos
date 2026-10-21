import type { Pool } from 'pg';
import { DatabaseService } from '../database/database.service';
import { CarteiraService } from './carteira.service';

function preparar(falhar = false) {
  const comandos: string[] = [];
  const cliente = {
    release: jest.fn(),
    query: jest.fn(async (sql: string) => {
      comandos.push(sql);
      if (sql.includes('FROM investidores WHERE')) {
        if (falhar) throw new Error('falha de leitura');
        return { rows: [{ saldoDisponivel: '100.00', saldoReservado: '0.00' }] };
      }
      if (sql.includes('GROUP BY i.id'))
        return { rows: [{ patrimonio: '100.00', lucroPrejuizo: '0.00' }] };
      return { rows: [] };
    }),
  };
  const pool = {
    connect: async () => cliente,
    query: jest.fn(() => {
      throw new Error('consulta fora da transação');
    }),
  } as unknown as Pool;
  return { service: new CarteiraService(new DatabaseService(pool)), comandos };
}

describe('leituras consistentes da carteira', () => {
  it('consulta saldo, posições e totais no mesmo cliente, com snapshot somente leitura', async () => {
    const { service, comandos } = preparar();
    const carteira = await service.carteira(7);
    expect(carteira.patrimonio).toBe('100.00');
    expect(comandos[0]).toBe('BEGIN');
    expect(comandos[1]).toBe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(comandos.at(-1)).toBe('COMMIT');
  });
  it('falha parcial descarta a leitura e libera a transação', async () => {
    const { service, comandos } = preparar(true);
    await expect(service.carteira(7)).rejects.toThrow('falha de leitura');
    expect(comandos.at(-1)).toBe('ROLLBACK');
    expect(comandos).not.toContain('COMMIT');
  });
  it('histórico de ordens e negócios também usa um snapshot único', async () => {
    const { service, comandos } = preparar();
    expect(await service.historico(7)).toEqual({ ordens: [], negocios: [] });
    expect(comandos[1]).toBe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(comandos.at(-1)).toBe('COMMIT');
  });
});
