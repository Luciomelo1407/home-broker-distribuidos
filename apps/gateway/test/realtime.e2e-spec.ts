import type { EventoMercado } from '@bolsa/contracts';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { WebSocket } from 'ws';
import { AppModule } from '../src/app.module';

// WebSocket contra Postgres, Redis e o Motor reais (docker compose up -d engine)
describe('WebSocket /ws', () => {
  let app: INestApplication;
  let base: string;
  const abertos: WebSocket[] = [];

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modulo.createNestApplication({ logger: false });
    await app.listen(0);
    const { port } = app.getHttpServer().address() as AddressInfo;
    base = `ws://127.0.0.1:${port}/ws`;
  });

  afterAll(async () => {
    for (const ws of abertos) ws.terminate();
    await app.close();
  });

  /** Cliente que guarda as mensagens e espera pela primeira que satisfaz o filtro. */
  function conectar(token?: string) {
    const ws = new WebSocket(token ? `${base}?token=${token}` : base);
    abertos.push(ws);
    const recebidas: EventoMercado[] = [];
    const ouvintes: (() => void)[] = [];
    ws.on('message', (dados) => {
      recebidas.push(JSON.parse(dados.toString()) as EventoMercado);
      for (const ouvir of ouvintes) ouvir();
    });
    const esperar = <T extends EventoMercado['tipo']>(
      tipo: T,
      filtro: (e: Extract<EventoMercado, { tipo: T }>) => boolean = () => true,
    ) =>
      new Promise<Extract<EventoMercado, { tipo: T }>>((resolver, rejeitar) => {
        const timer = setTimeout(() => rejeitar(new Error(`sem ${tipo} em 3 s`)), 3000);
        const ouvir = () => {
          const achado = recebidas.find(
            (e): e is Extract<EventoMercado, { tipo: T }> =>
              e.tipo === tipo && filtro(e as Extract<EventoMercado, { tipo: T }>),
          );
          if (achado) {
            clearTimeout(timer);
            resolver(achado);
          }
        };
        ouvintes.push(ouvir);
        ouvir();
      });
    return { ws, esperar };
  }

  async function investidorLogado(): Promise<string> {
    const credenciais = { nomeUsuario: `ws-${randomUUID().slice(0, 8)}`, senha: 'senha-123' };
    await request(app.getHttpServer()).post('/auth/cadastro').send(credenciais).expect(201);
    const { body } = await request(app.getHttpServer()).post('/auth/login').send(credenciais);
    return body.token as string;
  }

  const postarOrdem = (token: string, lado: 'COMPRA' | 'VENDA', preco: string) =>
    request(app.getHttpServer())
      .post('/ordens')
      .set('authorization', `Bearer ${token}`)
      .send({ clientOrderId: randomUUID(), ativo: 'DEF4', lado, quantidade: 5, preco })
      .expect(201);

  it.each([
    ['sem token', undefined],
    ['com token inválido', 'nao.e.jwt'],
  ])('T-12: recusa a conexão %s com ERRO e código 4401', async (_caso, token) => {
    const { ws, esperar } = conectar(token);
    const fechou = new Promise<number>((r) => ws.on('close', (codigo) => r(codigo)));

    await expect(esperar('ERRO')).resolves.toMatchObject({
      dados: { codigo: 'NAO_AUTENTICADO' },
    });
    await expect(fechou).resolves.toBe(4401);
  });

  it('manda o SNAPSHOT na abertura e a PRESENCA (RF-003, RF-004)', async () => {
    const { esperar } = conectar(await investidorLogado());

    const snapshot = await esperar('SNAPSHOT');
    expect(snapshot.dados.saldo).toBe('100000.00');
    expect(snapshot.dados.posicoes).toHaveLength(3);
    expect(snapshot.dados.ordensAbertas).toEqual([]);
    expect(snapshot.dados.mercado.map((m) => m.ativo)).toEqual(['ABC3', 'DEF4', 'GHI3']);
    await expect(esperar('PRESENCA')).resolves.toMatchObject({
      dados: { conectados: expect.any(Number) },
    });
  });

  it('avisa os dois lados de um negócio e todos do novo preço (RF-018)', async () => {
    const [tokenVendedor, tokenComprador, tokenOutro] = await Promise.all([
      investidorLogado(),
      investidorLogado(),
      investidorLogado(),
    ]);
    const vendedor = conectar(tokenVendedor);
    const comprador = conectar(tokenComprador);
    const outro = conectar(tokenOutro);
    await Promise.all([vendedor, comprador, outro].map((c) => c.esperar('SNAPSHOT')));

    // Preço alto para casar só entre os dois, sem ordens de outros testes no caminho
    const venda = await postarOrdem(tokenVendedor, 'VENDA', '9000.00');
    await postarOrdem(tokenComprador, 'COMPRA', '9000.00');

    await expect(
      vendedor.esperar(
        'ORDEM_ATUALIZADA',
        (e) => e.dados.id === venda.body.id && e.dados.status === 'EXECUTADA',
      ),
    ).resolves.toBeDefined();
    await expect(
      comprador.esperar('ORDEM_ATUALIZADA', (e) => e.dados.status === 'EXECUTADA'),
    ).resolves.toBeDefined();
    const negocio = await outro.esperar('NEGOCIO', (e) => e.dados.preco === '9000.00');
    expect(negocio.dados).toMatchObject({ ativo: 'DEF4', quantidade: 5 });
    await expect(
      outro.esperar('PRECO', (e) => e.dados.ativo === 'DEF4' && e.dados.precoAtual === '9000.00'),
    ).resolves.toBeDefined();
    // O outro investidor não vê as ordens de ninguém (RNF-08)
    await new Promise((r) => setTimeout(r, 100));
    await expect(outro.esperar('ORDEM_ATUALIZADA')).rejects.toThrow('sem ORDEM_ATUALIZADA');

    // E o GET /mercado já reflete o negócio (RF-017)
    const mercado = await request(app.getHttpServer()).get('/mercado');
    const def4 = mercado.body.ativos.find((a: { codigo: string }) => a.codigo === 'DEF4');
    expect(def4.precoAtual).toBe('9000.00');
  });
});
