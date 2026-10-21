import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Precisa do Postgres e do Redis do compose com as migrações aplicadas
describe('GET /carteira', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modulo.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(() => app.close());

  it('mostra o saldo e as ações iniciais de quem está logado (RF-005, S-01)', async () => {
    const credenciais = { nomeUsuario: `e2e-${randomUUID().slice(0, 8)}`, senha: 'senha-123' };
    await request(app.getHttpServer()).post('/auth/cadastro').send(credenciais).expect(201);
    const { body } = await request(app.getHttpServer()).post('/auth/login').send(credenciais);

    const res = await request(app.getHttpServer())
      .get('/carteira')
      .set('authorization', `Bearer ${body.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      saldoDisponivel: '100000.00',
      saldoReservado: '0.00',
      posicoes: ['ABC3', 'DEF4', 'GHI3'].map((ativo) => ({
        ativo,
        quantidadeDisponivel: 1000,
        quantidadeReservada: 0,
        precoMedio: '0.00',
      })),
    });
  });

  it('recusa sem token (401)', async () => {
    const res = await request(app.getHttpServer()).get('/carteira');

    expect(res.status).toBe(401);
    expect(res.body.erro.codigo).toBe('NAO_AUTENTICADO');
  });
});
