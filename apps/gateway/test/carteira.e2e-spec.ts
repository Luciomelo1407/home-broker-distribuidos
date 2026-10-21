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

  it('mostra saldo, ações iniciais, patrimônio e P/L de quem está logado (RF-005, S-01)', async () => {
    const credenciais = { nomeUsuario: `e2e-${randomUUID().slice(0, 8)}`, senha: 'senha-123' };
    await request(app.getHttpServer()).post('/auth/cadastro').send(credenciais).expect(201);
    const { body } = await request(app.getHttpServer()).post('/auth/login').send(credenciais);

    const res = await request(app.getHttpServer())
      .get('/carteira')
      .set('authorization', `Bearer ${body.token}`);

    expect(res.status).toBe(200);
    // Os preços atuais dependem dos negócios de outros testes: o esperado sai do GET /mercado
    const mercado = await request(app.getHttpServer()).get('/mercado');
    const preco = (codigo: string): number =>
      Number(mercado.body.ativos.find((a: { codigo: string }) => a.codigo === codigo).precoAtual);
    const centavos = (valor: number) => Math.round(valor * 100);
    const ativos = ['ABC3', 'DEF4', 'GHI3'];
    // 0004_preco_medio_inicial: as ações do cadastro entram com o preço inicial do ativo
    const inicial: Record<string, string> = { ABC3: '25.00', DEF4: '100.00', GHI3: '10.00' };
    expect(res.body).toEqual({
      saldoDisponivel: '100000.00',
      saldoReservado: '0.00',
      patrimonio: expect.any(String),
      lucroPrejuizo: expect.any(String),
      posicoes: ativos.map((ativo) => ({
        ativo,
        quantidadeDisponivel: 1000,
        quantidadeReservada: 0,
        precoMedio: inicial[ativo],
        precoAtual: expect.any(String),
        valorAtual: expect.any(String),
        lucroPrejuizo: expect.any(String),
      })),
    });
    // RF-005: patrimônio = saldo + ações a preço atual; P/L = (atual − médio) × quantidade
    const valorDasAcoes = ativos.reduce((total, a) => total + centavos(preco(a) * 1000), 0);
    const custo = ativos.reduce((total, a) => total + centavos(Number(inicial[a]) * 1000), 0);
    expect(centavos(Number(res.body.patrimonio))).toBe(10_000_000 + valorDasAcoes);
    expect(centavos(Number(res.body.lucroPrejuizo))).toBe(valorDasAcoes - custo);
  });

  it('mostra o histórico de ordens e negócios do investidor (RF-008)', async () => {
    const credenciais = { nomeUsuario: `e2e-${randomUUID().slice(0, 8)}`, senha: 'senha-123' };
    await request(app.getHttpServer()).post('/auth/cadastro').send(credenciais).expect(201);
    const { body } = await request(app.getHttpServer()).post('/auth/login').send(credenciais);

    const res = await request(app.getHttpServer())
      .get('/historico')
      .set('authorization', `Bearer ${body.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ordens: [], negocios: [] });
    expect((await request(app.getHttpServer()).get('/historico')).status).toBe(401);
  });

  it('recusa sem token (401)', async () => {
    const res = await request(app.getHttpServer()).get('/carteira');

    expect(res.status).toBe(401);
    expect(res.body.erro.codigo).toBe('NAO_AUTENTICADO');
  });
});
