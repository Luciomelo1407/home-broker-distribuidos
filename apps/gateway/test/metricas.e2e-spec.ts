import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// RF-026: o que o Prometheus lê (infra/prometheus/prometheus.yml)
describe('GET /metrics', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modulo.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(() => app.close());

  it('expõe as métricas da arquitetura §4.3 no formato do Prometheus', async () => {
    const res = await request(app.getHttpServer()).get('/metrics');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    for (const nome of [
      'bolsa_ordens_processadas_total',
      'bolsa_ordem_latencia_segundos',
      'bolsa_clientes_conectados',
      'bolsa_erros_total',
    ]) {
      expect(res.text).toContain(`# TYPE ${nome}`);
    }
  });
});
