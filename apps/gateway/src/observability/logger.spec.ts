import { Body, Controller, Get, INestApplication, Logger, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LoggerModule, Logger as PinoLogger } from 'nestjs-pino';
import { Writable } from 'node:stream';
import request from 'supertest';
import { CommonModule } from '../common/common.module';
import { opcoesDoLogger } from './logger';

@Controller('teste')
class TesteController {
  private readonly logger = new Logger(TesteController.name);

  @Post('login')
  login(@Body() corpo: { senha: string }): { token: string } {
    this.logger.log({ senha: corpo.senha, userId: 7 }, 'login recebido');
    return { token: 'jwt-secreto' };
  }

  @Get('falha')
  falha(): never {
    throw new Error('boom');
  }
}

describe('logger (pino com redact)', () => {
  let app: INestApplication;
  const linhas: Record<string, unknown>[] = [];

  beforeAll(async () => {
    const destino = new Writable({
      write(pedaco: Buffer, _codificacao, pronto) {
        for (const linha of pedaco.toString().split('\n').filter(Boolean)) {
          linhas.push(JSON.parse(linha) as Record<string, unknown>);
        }
        pronto();
      },
    });
    const modulo = await Test.createTestingModule({
      imports: [LoggerModule.forRoot(opcoesDoLogger('info', destino)), CommonModule],
      controllers: [TesteController],
    }).compile();
    app = modulo.createNestApplication({ bufferLogs: true });
    app.useLogger(app.get(PinoLogger));
    await app.init();
  });

  afterAll(() => app.close());

  beforeEach(() => {
    linhas.length = 0;
  });

  it('escreve JSON com ts, level, service e o requestId da resposta', async () => {
    const res = await request(app.getHttpServer()).post('/teste/login').send({ senha: 'x' });

    const fim = linhas.find((linha) => linha.msg === 'request completed');
    expect(fim).toMatchObject({
      level: 'info',
      service: 'gateway',
      requestId: res.headers['x-request-id'],
      req: { method: 'POST', url: '/teste/login' },
      res: { statusCode: 201 },
    });
    expect(typeof fim?.ts).toBe('string');
  });

  it('nunca escreve senha, token nem o header Authorization', async () => {
    await request(app.getHttpServer())
      .post('/teste/login')
      .set('authorization', 'Bearer jwt-do-cliente')
      .send({ senha: 'hunter2' });

    const texto = JSON.stringify(linhas);
    expect(texto).not.toContain('hunter2');
    expect(texto).not.toContain('jwt-do-cliente');
    expect(texto).not.toContain('jwt-secreto');
    expect(linhas.find((linha) => linha.msg === 'login recebido')).toMatchObject({
      senha: '[oculto]',
      userId: 7,
    });
  });

  it('registra resposta 500 com level error', async () => {
    await request(app.getHttpServer()).get('/teste/falha');

    // pino-http troca a mensagem para 'request errored' quando o status é >= 500
    expect(linhas.find((linha) => linha.msg === 'request errored')).toMatchObject({
      level: 'error',
      res: { statusCode: 500 },
    });
  });
});
