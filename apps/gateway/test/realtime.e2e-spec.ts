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
  function conectar(token?: string, opcoes: { autoPong?: boolean } = {}) {
    const ws = new WebSocket(token ? `${base}?token=${token}` : base, opcoes);
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
    return { ws, esperar, recebidas };
  }

  async function investidorLogado(): Promise<string> {
    const credenciais = { nomeUsuario: `ws-${randomUUID().slice(0, 8)}`, senha: 'senha-123' };
    await request(app.getHttpServer()).post('/auth/cadastro').send(credenciais).expect(201);
    const { body } = await request(app.getHttpServer()).post('/auth/login').send(credenciais);
    return body.token as string;
  }

  const postarOrdem = (token: string, ativo: string, lado: 'COMPRA' | 'VENDA', preco: string) =>
    request(app.getHttpServer())
      .post('/ordens')
      .set('authorization', `Bearer ${token}`)
      .send({ clientOrderId: randomUUID(), ativo, lado, quantidade: 5, preco })
      .expect(201);

  /**
   * Um ativo e um preço dentro do spread atual dele: acima da melhor compra e abaixo da
   * melhor venda. Uma venda nesse preço vira a melhor oferta, e uma compra nele só casa com
   * ela, sejam quais forem as ordens que outros testes ou o k6 deixaram no banco.
   */
  async function precoNoSpread(
    candidatos: string[] = ['DEF4', 'ABC3', 'GHI3'],
  ): Promise<{ ativo: string; preco: string }> {
    const centavos = (preco?: string) =>
      preco === undefined ? undefined : Math.round(Number(preco) * 100);
    for (const ativo of candidatos) {
      const { body } = await request(app.getHttpServer()).get(`/mercado/livro/${ativo}`);
      const compra = centavos(body.ofertasCompra[0]?.preco) ?? 1;
      const venda = centavos(body.ofertasVenda[0]?.preco) ?? compra + 100_000;
      // Com 1 centavo de diferença não há preço no meio; tenta o próximo ativo
      if (venda - compra < 2) continue;
      const meio = Math.floor((compra + venda) / 2);
      return { ativo, preco: `${Math.floor(meio / 100)}.${String(meio % 100).padStart(2, '0')}` };
    }
    throw new Error('nenhum ativo com espaço no spread; use um banco limpo');
  }

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

    const { ativo, preco } = await precoNoSpread();
    const venda = await postarOrdem(tokenVendedor, ativo, 'VENDA', preco);
    await postarOrdem(tokenComprador, ativo, 'COMPRA', preco);

    await expect(
      vendedor.esperar(
        'ORDEM_ATUALIZADA',
        (e) => e.dados.id === venda.body.id && e.dados.status === 'EXECUTADA',
      ),
    ).resolves.toBeDefined();
    await expect(
      comprador.esperar('ORDEM_ATUALIZADA', (e) => e.dados.status === 'EXECUTADA'),
    ).resolves.toBeDefined();
    const negocio = await outro.esperar('NEGOCIO', (e) => e.dados.preco === preco);
    expect(negocio.dados).toMatchObject({ ativo, quantidade: 5 });
    await expect(
      outro.esperar('PRECO', (e) => e.dados.ativo === ativo && e.dados.precoAtual === preco),
    ).resolves.toBeDefined();
    // O outro investidor não vê as ordens de ninguém (RNF-08)
    await new Promise((r) => setTimeout(r, 100));
    await expect(outro.esperar('ORDEM_ATUALIZADA')).rejects.toThrow('sem ORDEM_ATUALIZADA');

    // E o GET /mercado acompanha os PRECO (RF-017). Os agentes do compose podem ter feito
    // outro negócio no ativo depois do nosso, então vale qualquer preço que chegou por evento
    const mercado = await request(app.getHttpServer()).get('/mercado');
    const negociado = mercado.body.ativos.find((a: { codigo: string }) => a.codigo === ativo);
    await new Promise((r) => setTimeout(r, 100));
    const recebidos = outro.recebidas.flatMap((e) =>
      e.tipo === 'PRECO' && e.dados.ativo === ativo ? [e.dados.precoAtual] : [],
    );
    expect(recebidos).toContain(negociado.precoAtual);
  });

  it('RF-007: uma ordem que não casa aparece no livro de todos, agregada por preço', async () => {
    const [tokenA, tokenB] = await Promise.all([investidorLogado(), investidorLogado()]);
    const observador = conectar(tokenB);
    await observador.esperar('SNAPSHOT');
    // O LIVRO de cada ativo chega logo depois do SNAPSHOT
    await observador.esperar('LIVRO', (e) => e.dados.ativo === 'GHI3');
    const { ativo, preco } = await precoNoSpread();

    // Dentro do spread: não casa com nada e vira a melhor compra, então entra no top-5
    const compra = (quantidade: number) =>
      request(app.getHttpServer())
        .post('/ordens')
        .set('authorization', `Bearer ${tokenA}`)
        .send({ clientOrderId: randomUUID(), ativo, lado: 'COMPRA', quantidade, preco })
        .expect(201);
    await compra(3);
    await compra(4);

    const temNivel = (ofertas: { preco: string; quantidade: number }[]) =>
      ofertas.some((o) => o.preco === preco && o.quantidade >= 7);
    await expect(
      observador.esperar(
        'LIVRO',
        (e) => e.dados.ativo === ativo && temNivel(e.dados.ofertasCompra),
      ),
    ).resolves.toBeDefined();

    const rest = await request(app.getHttpServer()).get(`/mercado/livro/${ativo}`);
    expect(rest.status).toBe(200);
    expect(rest.body.ofertasCompra.length).toBeLessThanOrEqual(5);
    // Melhor compra primeiro: preços em ordem decrescente
    const precos = rest.body.ofertasCompra.map((o: { preco: string }) => Number(o.preco));
    expect([...precos].sort((a, b) => b - a)).toEqual(precos);
    expect((await request(app.getHttpServer()).get('/mercado/livro/XYZ9')).status).toBe(404);
  });

  it('RF-023: quem para de responder ao ping cai em até 10 s e sai da presença', async () => {
    const [tokenMudo, tokenOutro] = await Promise.all([investidorLogado(), investidorLogado()]);
    const outro = conectar(tokenOutro);
    await outro.esperar('SNAPSHOT');
    // autoPong: false faz o papel da rede caída: a conexão fica aberta, mas muda
    const mudo = conectar(tokenMudo, { autoPong: false });
    await mudo.esperar('SNAPSHOT');
    // Maior total visto depois que o mudo entrou: a queda tem de ficar abaixo dele
    await new Promise((r) => setTimeout(r, 200));
    const comMudo = Math.max(
      ...outro.recebidas.flatMap((e) => (e.tipo === 'PRESENCA' ? [e.dados.conectados] : [])),
    );
    const fechou = new Promise<number>((r) => mudo.ws.on('close', () => r(Date.now())));
    const inicio = Date.now();

    const fim = await fechou;

    expect(fim - inicio).toBeLessThanOrEqual(10_500);
    await expect(
      outro.esperar('PRESENCA', (e) => e.dados.conectados < comMudo),
    ).resolves.toBeDefined();
  }, 15_000);
});
