import { Global, INestApplication, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { hash, verify } from '@node-rs/argon2';
import type { Pool } from 'pg';
import request from 'supertest';
import { CarteiraModule } from '../carteira/carteira.module';
import { CommonModule } from '../common/common.module';
import { DatabaseService } from '../database/database.service';
import { AuthModule } from './auth.module';

// Integração HTTP sem serviços: módulos, DTOs, guard, JWT, Argon2 e transações reais;
// somente o pool do Postgres é controlado. Os e2e com serviços continuam em test/.
const cliente = { query: jest.fn(), release: jest.fn() };
const pool = { query: jest.fn(), connect: jest.fn(), end: jest.fn() };
const valores: Record<string, unknown> = {
  JWT_SECRET: 'segredo-exclusivo-dos-testes-http',
  JWT_EXPIRACAO: '1h',
  SALDO_INICIAL: '100000.00',
  ACOES_INICIAIS: 1000,
  AGENTES_CONSERVADORES: 0,
  AGENTES_AGRESSIVOS: 0,
  AGENTES_SENHA: 'senha-agente-teste',
};
@Global()
@Module({
  providers: [
    { provide: DatabaseService, useValue: new DatabaseService(pool as unknown as Pool) },
    { provide: ConfigService, useValue: { get: (chave: string) => valores[chave] } },
  ],
  exports: [DatabaseService, ConfigService],
})
class DependenciasDeTeste {}

describe('auth e carteira pela camada HTTP, com pool controlado', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let senhaHash: string;
  beforeAll(async () => {
    pool.query.mockResolvedValue({ rows: [] });
    pool.end.mockResolvedValue(undefined);
    const modulo = await Test.createTestingModule({
      imports: [DependenciasDeTeste, CommonModule, AuthModule, CarteiraModule],
    }).compile();
    app = modulo.createNestApplication({ logger: false });
    await app.init();
    jwt = app.get(JwtService);
    senhaHash = await hash('senha-123');
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => {
    pool.query.mockReset().mockResolvedValue({ rows: [] });
    pool.connect.mockReset().mockResolvedValue(cliente);
    cliente.release.mockClear();
    cliente.query.mockReset().mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO investidores')) return { rows: [{ id: 41 }] };
      return { rows: [] };
    });
  });
  const http = () => request(app.getHttpServer());

  it('cadastro confirma investidor e posições juntos, sem expor hash/senha', async () => {
    const res = await http()
      .post('/auth/cadastro')
      .send({ nomeUsuario: 'ana', senha: 'senha-123' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 41, nomeUsuario: 'ana', saldoDisponivel: '100000.00' });
    const insercao = cliente.query.mock.calls.find(([sql]: [string]) =>
      sql.includes('INSERT INTO investidores'),
    );
    const parametros = insercao?.[1] as unknown[];
    expect(parametros[0]).toBe('ana');
    expect(parametros[1]).toMatch(/^\$argon2id\$/);
    expect(await verify(parametros[1] as string, 'senha-123')).toBe(true);
    const sql = cliente.query.mock.calls.map(([comando]: [string]) => comando);
    expect(sql[0]).toBe('BEGIN');
    expect(sql[2]).toContain('INSERT INTO posicoes');
    expect(sql.at(-1)).toBe('COMMIT');
    expect(cliente.release).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['cadastro', { nomeUsuario: 'ana', senha: 'curta' }],
    ['cadastro', { nomeUsuario: 'a b', senha: 'senha-123' }],
    ['cadastro', { nomeUsuario: 'ana', senha: 'senha-123', saldoDisponivel: '999999.00' }],
    ['cadastro', { nomeUsuario: 'ana', senha: 'senha-123', investidorId: 99 }],
    ['login', { nomeUsuario: 42, senha: 'senha-123' }],
    ['login', { nomeUsuario: 'ana', senha: null }],
  ])('DTO inválido em /auth/%s não chega ao banco', async (rota, corpo) => {
    const res = await http().post(`/auth/${rota}`).send(corpo);
    expect(res.status).toBe(400);
    expect(res.body.erro.codigo).toBe('VALIDACAO');
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
    expect(pool.query).not.toHaveBeenCalled();
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('nome duplicado devolve 409 e faz rollback', async () => {
    cliente.query.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO investidores'))
        throw Object.assign(new Error('unique'), { code: '23505' });
      return { rows: [] };
    });
    const res = await http()
      .post('/auth/cadastro')
      .send({ nomeUsuario: 'ana', senha: 'senha-123' });
    expect(res.status).toBe(409);
    expect(res.body.erro.codigo).toBe('USUARIO_JA_EXISTE');
    expect(cliente.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(cliente.release).toHaveBeenCalledTimes(1);
  });

  it('falha nas posições faz rollback do cadastro inteiro e oculta detalhes internos', async () => {
    cliente.query.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO investidores')) return { rows: [{ id: 41 }] };
      if (sql.includes('INSERT INTO posicoes')) throw new Error('detalhe privado do banco');
      return { rows: [] };
    });
    const res = await http()
      .post('/auth/cadastro')
      .send({ nomeUsuario: 'ana', senha: 'senha-123' });
    expect(res.status).toBe(500);
    expect(res.body.erro).toEqual({ codigo: 'ERRO_INTERNO', mensagem: 'erro interno' });
    expect(cliente.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(cliente.query.mock.calls.some(([sql]: [string]) => sql === 'COMMIT')).toBe(false);
  });

  it.each([false, true])(
    'usuário existente=%s com credenciais incorretas recebe a mesma recusa',
    async (existe) => {
      pool.query.mockResolvedValue({ rows: existe ? [{ id: 41, senhaHash }] : [] });
      const res = await http()
        .post('/auth/login')
        .send({ nomeUsuario: 'ana', senha: 'senha-errada' });
      expect(res.status).toBe(401);
      expect(res.body.erro).toEqual({
        codigo: 'CREDENCIAIS_INVALIDAS',
        mensagem: 'usuário ou senha incorretos',
      });
    },
  );

  it('login emite token aceito pelo guard; identidade das consultas vem do token', async () => {
    pool.query.mockResolvedValue({ rows: [{ id: 41, senhaHash }] });
    const login = await http().post('/auth/login').send({ nomeUsuario: 'ana', senha: 'senha-123' });
    expect(login.status).toBe(200);
    expect(login.body.investidor).toEqual({ id: 41, nomeUsuario: 'ana' });
    const res = await http()
      .get('/historico?investidorId=99')
      .set('authorization', `Bearer ${login.body.token}`);
    expect(res.status).toBe(200);
    const consultas = cliente.query.mock.calls.filter(
      ([, parametros]: [string, unknown[]?]) => parametros,
    );
    expect(consultas).toHaveLength(2);
    expect(consultas.every(([, parametros]: [string, unknown[]]) => parametros[0] === 41)).toBe(
      true,
    );
  });

  it.each(['carteira', 'historico'])(
    'recusa /%s sem autenticação antes de consultar dados privados',
    async (rota) => {
      const res = await http().get(`/${rota}`);
      expect(res.status).toBe(401);
      expect(res.body.erro.codigo).toBe('NAO_AUTENTICADO');
      expect(pool.connect).not.toHaveBeenCalled();
    },
  );

  it.each(['expirado', 'outra-chave', 'sub-invalido', 'ausente'])(
    'token %s não ultrapassa o guard',
    async (caso) => {
      const token =
        caso === 'expirado'
          ? await jwt.signAsync({ sub: 41 }, { expiresIn: -1 })
          : caso === 'outra-chave'
            ? await new JwtService({ secret: 'outra-chave' }).signAsync({ sub: 41 })
            : caso === 'sub-invalido'
              ? await jwt.signAsync({ sub: '41' })
              : 'nao.e.jwt';
      const res = await http().get('/carteira').set('authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
      expect(pool.connect).not.toHaveBeenCalled();
    },
  );

  it('duas identidades leem somente seus próprios parâmetros de carteira', async () => {
    cliente.query.mockImplementation(async (sql: string, parametros?: unknown[]) => {
      if (sql.includes('FROM investidores WHERE'))
        return { rows: [{ saldoDisponivel: `${parametros?.[0]}.00`, saldoReservado: '0.00' }] };
      return { rows: [] };
    });
    for (const id of [41, 42]) {
      const token = await jwt.signAsync({ sub: id });
      const res = await http().get('/carteira').set('authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.saldoDisponivel).toBe(`${id}.00`);
      expect(cliente.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM investidores WHERE'),
        [id],
      );
    }
  });
});
