import { Body, Controller, Get, INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IsInt, Min } from 'class-validator';
import request from 'supertest';
import { AppError, CodigoErro } from './app-error';
import { CommonModule } from './common.module';

class CriarDto {
  @IsInt({ message: 'quantidade deve ser inteira' })
  @Min(1, { message: 'quantidade deve ser maior que zero' })
  quantidade!: number;
}

@Controller('teste')
class TesteController {
  @Post()
  criar(@Body() dto: CriarDto): CriarDto {
    return dto;
  }

  @Get('app-error')
  appError(): never {
    throw new AppError(CodigoErro.USUARIO_JA_EXISTE, 409, 'nome de usuário já cadastrado');
  }

  @Get('inesperado')
  inesperado(): never {
    throw new Error('senha do banco: hunter2');
  }
}

describe('CommonModule (filtro de erros, validação e request id)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [CommonModule],
      controllers: [TesteController],
    }).compile();
    app = modulo.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(() => app.close());

  it('traduz AppError para o formato da arquitetura §4.2', async () => {
    const res = await request(app.getHttpServer()).get('/teste/app-error');

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      erro: { codigo: 'USUARIO_JA_EXISTE', mensagem: 'nome de usuário já cadastrado' },
      requestId: expect.any(String),
    });
    expect(res.headers['x-request-id']).toBe(res.body.requestId);
  });

  it('esconde o detalhe de exceções desconhecidas (500 ERRO_INTERNO)', async () => {
    const res = await request(app.getHttpServer()).get('/teste/inesperado');

    expect(res.status).toBe(500);
    expect(res.body.erro).toEqual({ codigo: 'ERRO_INTERNO', mensagem: 'erro interno' });
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });

  it('recusa DTO inválido com 400 VALIDACAO e os campos', async () => {
    const res = await request(app.getHttpServer()).post('/teste').send({ quantidade: 0 });

    expect(res.status).toBe(400);
    expect(res.body.erro).toEqual({
      codigo: 'VALIDACAO',
      mensagem: 'quantidade deve ser maior que zero',
      campos: ['quantidade'],
    });
  });

  it('recusa campo fora do DTO, como userId no corpo (RNF-08)', async () => {
    const res = await request(app.getHttpServer())
      .post('/teste')
      .send({ quantidade: 1, userId: 2 });

    expect(res.status).toBe(400);
    expect(res.body.erro.codigo).toBe('VALIDACAO');
    expect(res.body.erro.campos).toEqual(['userId']);
  });

  it('aceita DTO válido', async () => {
    const res = await request(app.getHttpServer()).post('/teste').send({ quantidade: 5 });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ quantidade: 5 });
  });

  it('responde rota inexistente com 404 NAO_ENCONTRADO', async () => {
    const res = await request(app.getHttpServer()).get('/nao-existe');

    expect(res.status).toBe(404);
    expect(res.body.erro.codigo).toBe('NAO_ENCONTRADO');
  });

  it('responde JSON malformado com 400 VALIDACAO', async () => {
    const res = await request(app.getHttpServer())
      .post('/teste')
      .set('content-type', 'application/json')
      .send('{"quantidade":');

    expect(res.status).toBe(400);
    expect(res.body.erro.codigo).toBe('VALIDACAO');
    expect(res.body.requestId).toEqual(expect.any(String));
  });

  it('reaproveita um x-request-id válido do cliente e troca um inválido', async () => {
    const valido = await request(app.getHttpServer())
      .get('/teste/app-error')
      .set('x-request-id', 'abc-123');
    const invalido = await request(app.getHttpServer())
      .get('/teste/app-error')
      .set('x-request-id', 'tem espaço e é longo demais '.repeat(5));

    expect(valido.body.requestId).toBe('abc-123');
    expect(invalido.body.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
