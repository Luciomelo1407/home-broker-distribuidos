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

  it('T-10 e RF-012: só o dono consulta e cancela, e o cancelamento devolve a reserva', async () => {
    const [tokenA, tokenB] = await Promise.all([investidorLogado(), investidorLogado()]);
    const http = () => request(app.getHttpServer());
    const criada = await http()
      .post('/ordens')
      .set('authorization', `Bearer ${tokenA}`)
      .send(ordem('COMPRA', 10, '1.00'))
      .expect(201);
    const caminho = `/ordens/${criada.body.id}`;

    // B não vê, não cancela e não consegue se passar por A no corpo (RNF-08)
    // Uma requisição por vez: o supertest abre e fecha o servidor a cada uma
    for (const metodo of ['get', 'delete'] as const) {
      const res = await http()[metodo](caminho).set('authorization', `Bearer ${tokenB}`);
      expect(res.status).toBe(403);
      expect(res.body.erro.codigo).toBe('ORDEM_DE_OUTRO_INVESTIDOR');
    }
    const comoA = await http()
      .post('/ordens')
      .set('authorization', `Bearer ${tokenB}`)
      .send({ ...ordem('COMPRA', 1, '1.00'), investidorId: criada.body.investidorId });
    expect(comoA.status).toBe(400);

    const consulta = await http().get(caminho).set('authorization', `Bearer ${tokenA}`);
    expect(consulta.body).toMatchObject({ id: criada.body.id, status: 'ABERTA' });

    const cancelada = await http().delete(caminho).set('authorization', `Bearer ${tokenA}`);
    expect(cancelada.status).toBe(200);
    expect(cancelada.body).toMatchObject({ id: criada.body.id, status: 'CANCELADA' });
    const carteira = await http().get('/carteira').set('authorization', `Bearer ${tokenA}`);
    expect(carteira.body).toMatchObject({ saldoDisponivel: '100000.00', saldoReservado: '0.00' });

    const deNovo = await http().delete(caminho).set('authorization', `Bearer ${tokenA}`);
    expect(deNovo.status).toBe(409);
    expect(deNovo.body.erro.codigo).toBe('ORDEM_NAO_CANCELAVEL');
  });
});
