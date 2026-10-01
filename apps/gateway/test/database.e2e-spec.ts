import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';

// Precisa do Postgres do compose com as migrações aplicadas:
//   docker compose up -d --wait postgres && docker compose up engine
describe('Gateway contra o Postgres real', () => {
  let app: INestApplication;
  let db: DatabaseService;

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modulo.createNestApplication({ logger: false });
    await app.init();
    db = app.get(DatabaseService);
  });

  afterAll(() => app.close());

  it('sobe o AppModule e responde erros no formato padrão', async () => {
    const res = await request(app.getHttpServer()).get('/nao-existe');

    expect(res.status).toBe(404);
    expect(res.body.erro.codigo).toBe('NAO_ENCONTRADO');
  });

  it('enxerga os 3 ativos da migração 0002', async () => {
    const { rows } = await db.query<{ total: string }>('SELECT count(*) AS total FROM ativos');

    expect(Number(rows[0]?.total)).toBe(3);
  });

  it('desfaz o INSERT do cadastro quando a transação falha', async () => {
    const nome = `e2e-${randomUUID().slice(0, 8)}`;

    await expect(
      db.transacao(async (cliente) => {
        await cliente.query(
          `INSERT INTO investidores (nome_usuario, senha_hash, saldo_disponivel)
           VALUES ($1, 'hash', 100000.00)`,
          [nome],
        );
        throw new Error('falha depois do INSERT');
      }),
    ).rejects.toThrow('falha depois do INSERT');

    const { rowCount } = await db.query('SELECT 1 FROM investidores WHERE nome_usuario = $1', [
      nome,
    ]);
    expect(rowCount).toBe(0);
  });

  it('é impedido pelo banco de alterar saldo (só o Motor escreve dinheiro)', async () => {
    await expect(
      db.query('UPDATE investidores SET saldo_disponivel = saldo_disponivel + 1'),
    ).rejects.toMatchObject({ code: '42501' }); // insufficient_privilege
  });
});
