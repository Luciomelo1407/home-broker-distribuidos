import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Ponto de controle de 10/10 (plano §1): ordem com token, de ponta a ponta
// (Gateway → stream → Motor → Postgres → resposta). Precisa do Motor de pé:
//   docker compose up -d --build engine
describe('POST /ordens com o Motor real', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
    const batimento = await redis.get('motor:heartbeat');
    await redis.quit();
    if (!batimento) throw new Error('Motor fora do ar: suba com docker compose up -d engine');

    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modulo.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(() => app?.close());

  async function investidorLogado(): Promise<string> {
    const credenciais = { nomeUsuario: `e2e-${randomUUID().slice(0, 8)}`, senha: 'senha-123' };
    await request(app.getHttpServer()).post('/auth/cadastro').send(credenciais).expect(201);
    const login = await request(app.getHttpServer()).post('/auth/login').send(credenciais);
    return login.body.token as string;
  }

  const ordem = (lado: 'COMPRA' | 'VENDA', quantidade: number, preco: string) => ({
    clientOrderId: randomUUID(),
    ativo: 'GHI3',
    lado,
    quantidade,
    preco,
  });

  it('cria a ordem e responde com ela depois do Motor (201)', async () => {
    const token = await investidorLogado();
    const corpo = ordem('COMPRA', 10, '1.00');

    const res = await request(app.getHttpServer())
      .post('/ordens')
      .set('authorization', `Bearer ${token}`)
      .send(corpo);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: expect.any(Number),
      clientOrderId: corpo.clientOrderId,
      ativo: 'GHI3',
      lado: 'COMPRA',
      precoLimite: '1.00',
      quantidade: 10,
      status: 'ABERTA',
    });

    // Reenvio com o mesmo clientOrderId: a mesma ordem, sem duplicar (T-08)
    const reenvio = await request(app.getHttpServer())
      .post('/ordens')
      .set('authorization', `Bearer ${token}`)
      .send(corpo);
    expect(reenvio.body.id).toBe(res.body.id);

    // RF-009: a compra reservou 10 × 1,00, uma vez só
    const carteira = await request(app.getHttpServer())
      .get('/carteira')
      .set('authorization', `Bearer ${token}`);
    expect(carteira.body).toMatchObject({ saldoDisponivel: '99990.00', saldoReservado: '10.00' });
  });

  it('devolve a ordem REJEITADA com o motivo quando falta saldo', async () => {
    const token = await investidorLogado();

    const res = await request(app.getHttpServer())
      .post('/ordens')
      .set('authorization', `Bearer ${token}`)
      .send(ordem('COMPRA', 1_000_000, '10.00'));

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'REJEITADA', motivoRejeicao: 'SALDO_INSUFICIENTE' });
  });
});
