import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Precisa do Postgres do compose com as migrações aplicadas (ver database.e2e-spec.ts)
describe('GET /mercado', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modulo.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(() => app.close());

  it('devolve os 3 ativos da migração 0002 no formato MercadoResposta', async () => {
    const res = await request(app.getHttpServer()).get('/mercado');

    expect(res.status).toBe(200);
    expect(res.body.ativos.map((ativo: { codigo: string }) => ativo.codigo)).toEqual([
      'ABC3',
      'DEF4',
      'GHI3',
    ]);
    for (const ativo of res.body.ativos) {
      expect(ativo).toEqual({
        codigo: expect.stringMatching(/^[A-Z]{3,4}\d$/),
        nomeEmpresa: expect.any(String),
        precoAtual: expect.stringMatching(/^\d+\.\d{2}$/),
        precoReferencia: expect.stringMatching(/^\d+\.\d{2}$/),
        variacao: expect.stringMatching(/^-?\d+\.\d{2}$/),
        volume: expect.any(Number),
      });
    }
  });
});
