import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';

// T-12. Precisa do Postgres e do Redis do compose com as migrações aplicadas
describe('auth (T-12)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  const nomeUsuario = `e2e-${randomUUID().slice(0, 8)}`;
  const senha = 'senha-forte-123';

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modulo.createNestApplication({ logger: false });
    await app.init();
    db = app.get(DatabaseService);
  });

  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());

  it('cadastra com saldo e ações iniciais (RF-001, S-01)', async () => {
    const res = await http().post('/auth/cadastro').send({ nomeUsuario, senha });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: expect.any(Number), nomeUsuario, saldoDisponivel: '100000.00' });
    const { rows } = await db.query<{ total: string; acoes: string }>(
      `SELECT count(*) AS total, sum(quantidade_disponivel) AS acoes FROM posicoes
        WHERE investidor_id = $1`,
      [res.body.id],
    );
    expect(rows[0]).toEqual({ total: '3', acoes: '3000' });
  });

  it('grava a senha só como hash argon2id', async () => {
    const { rows } = await db.query<{ senhaHash: string }>(
      'SELECT senha_hash AS "senhaHash" FROM investidores WHERE nome_usuario = $1',
      [nomeUsuario],
    );

    expect(rows[0]?.senhaHash).toMatch(/^\$argon2id\$/);
    expect(rows[0]?.senhaHash).not.toContain(senha);
  });

  it('recusa nome de usuário repetido com 409', async () => {
    const res = await http().post('/auth/cadastro').send({ nomeUsuario, senha });

    expect(res.status).toBe(409);
    expect(res.body.erro.codigo).toBe('USUARIO_JA_EXISTE');
  });

  it.each([
    ['senha errada', { nomeUsuario, senha: 'outra-senha' }],
    ['usuário inexistente', { nomeUsuario: 'nao-existe-mesmo', senha }],
  ])('login com %s → 401 CREDENCIAIS_INVALIDAS', async (_caso, corpo) => {
    const res = await http().post('/auth/login').send(corpo);

    expect(res.status).toBe(401);
    expect(res.body.erro.codigo).toBe('CREDENCIAIS_INVALIDAS');
  });

  it('login certo devolve um JWT aceito nas rotas protegidas', async () => {
    const login = await http().post('/auth/login').send({ nomeUsuario, senha });
    expect(login.status).toBe(200);
    expect(login.body.investidor.nomeUsuario).toBe(nomeUsuario);

    // DTO inválido de propósito: passou do 401, então o token foi aceito
    const res = await http()
      .post('/ordens')
      .set('authorization', `Bearer ${login.body.token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it.each([
    ['sem token', undefined],
    ['token inválido', 'Bearer nao.e.jwt'],
    ['outro esquema', 'Basic abc'],
  ])('REST %s → 401 NAO_AUTENTICADO', async (_caso, header) => {
    const req = http().post('/ordens');
    if (header) req.set('authorization', header);

    const res = await req.send({});

    expect(res.status).toBe(401);
    expect(res.body.erro.codigo).toBe('NAO_AUTENTICADO');
  });
});
