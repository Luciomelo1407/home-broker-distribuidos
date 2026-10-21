import type { OrdemRespostaDto } from '@bolsa/contracts';
import { CanActivate, ExecutionContext, Global, INestApplication, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { CommonModule } from '../common/common.module';
import type { RequisicaoAutenticada } from '../common/usuario-atual';
import { DatabaseService } from '../database/database.service';
import {
  BarramentoDeOrdens,
  BarramentoIndisponivel,
  ComandoCriarOrdem,
  ComandoNaoConfirmado,
} from './barramento-de-ordens';
import { OrdensModule } from './ordens.module';

// Faz o papel do guard do auth: o header x-teste-usuario vira req.usuario
class GuardDeTeste implements CanActivate {
  canActivate(contexto: ExecutionContext): boolean {
    const req = contexto
      .switchToHttp()
      .getRequest<RequisicaoAutenticada & { headers: Record<string, string> }>();
    const id = req.headers['x-teste-usuario'];
    if (id) req.usuario = { id: Number(id) };
    return true;
  }
}

const enviarEAguardar = jest.fn<Promise<OrdemRespostaDto>, [ComandoCriarOrdem, number]>();

@Global()
@Module({
  providers: [
    {
      provide: DatabaseService,
      useValue: { query: async () => ({ rows: [{ codigo: 'ABC3' }, { codigo: 'DEF4' }] }) },
    },
    { provide: BarramentoDeOrdens, useValue: { enviarEAguardar } },
    { provide: ConfigService, useValue: { get: () => 3000 } },
    { provide: APP_GUARD, useClass: GuardDeTeste },
  ],
  exports: [DatabaseService, BarramentoDeOrdens, ConfigService],
})
class DependenciasFalsas {}

const ordemValida = {
  clientOrderId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  ativo: 'ABC3',
  lado: 'COMPRA',
  quantidade: 100,
  preco: '25.50',
};

function respostaDoMotor(comando: ComandoCriarOrdem): OrdemRespostaDto {
  return {
    id: 42,
    clientOrderId: comando.clientOrderId,
    investidorId: comando.investidorId,
    ativo: comando.ativo,
    lado: comando.lado,
    precoLimite: comando.preco,
    quantidade: comando.quantidade,
    quantidadeExecutada: 0,
    status: 'ABERTA',
  };
}

describe('POST /ordens', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [DependenciasFalsas, CommonModule, OrdensModule],
    }).compile();
    app = modulo.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(() => app.close());

  beforeEach(() => {
    enviarEAguardar.mockReset();
    enviarEAguardar.mockImplementation(async (comando) => respostaDoMotor(comando));
  });

  const postar = (corpo: object, usuario: string | null = '7') => {
    const req = request(app.getHttpServer()).post('/ordens');
    if (usuario) req.set('x-teste-usuario', usuario);
    return req.send(corpo);
  };

  it('envia o comando CRIAR com o investidor do token e devolve a ordem (201)', async () => {
    const res = await postar(ordemValida);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 42, investidorId: 7, status: 'ABERTA' });
    expect(enviarEAguardar).toHaveBeenCalledWith(
      { tipo: 'CRIAR', investidorId: 7, ...ordemValida },
      3000,
    );
  });

  it('devolve 201 também quando o Motor rejeita a ordem', async () => {
    enviarEAguardar.mockImplementation(async (comando) => ({
      ...respostaDoMotor(comando),
      status: 'REJEITADA',
      motivoRejeicao: 'SALDO_INSUFICIENTE',
    }));

    const res = await postar(ordemValida);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'REJEITADA', motivoRejeicao: 'SALDO_INSUFICIENTE' });
  });

  it('recusa sem investidor autenticado (401) e não envia nada', async () => {
    const res = await postar(ordemValida, null);

    expect(res.status).toBe(401);
    expect(res.body.erro.codigo).toBe('NAO_AUTENTICADO');
    expect(enviarEAguardar).not.toHaveBeenCalled();
  });

  // T-13: matriz de entradas inválidas → 400 e nada chega ao stream
  it.each([
    ['quantidade', 0],
    ['quantidade', -1],
    ['quantidade', 1.5],
    ['quantidade', 'abc'],
    ['quantidade', '10'],
    ['quantidade', 2_147_483_648],
    ['preco', '0'],
    ['preco', '0.00'],
    ['preco', '1.234'],
    ['preco', '-1.00'],
    ['preco', 25.5],
    ['preco', 'abc'],
    ['preco', '12345678901234.00'],
    ['ativo', 'XYZ9'],
    ['ativo', 'abc3'],
    ['ativo', ''],
    ['lado', 'compra'],
    ['lado', 'TROCA'],
    ['clientOrderId', 'nao-e-uuid'],
  ])('T-13: %s = %j → 400 VALIDACAO', async (campo, valor) => {
    const res = await postar({ ...ordemValida, [campo]: valor });

    expect(res.status).toBe(400);
    expect(res.body.erro.codigo).toBe('VALIDACAO');
    expect(res.body.erro.campos).toContain(campo);
    expect(enviarEAguardar).not.toHaveBeenCalled();
  });

  it.each(['investidorId', 'userId', 'status'])(
    'T-13 / RNF-08: campo extra %s no corpo → 400',
    async (campo) => {
      const res = await postar({ ...ordemValida, [campo]: 99 });

      expect(res.status).toBe(400);
      expect(res.body.erro.campos).toEqual([campo]);
      expect(enviarEAguardar).not.toHaveBeenCalled();
    },
  );

  it.each(['clientOrderId', 'ativo', 'lado', 'quantidade', 'preco'])(
    'T-13: sem %s → 400',
    async (campo) => {
      const corpo: Record<string, unknown> = { ...ordemValida };
      delete corpo[campo];

      const res = await postar(corpo);

      expect(res.status).toBe(400);
      expect(res.body.erro.campos).toContain(campo);
      expect(enviarEAguardar).not.toHaveBeenCalled();
    },
  );

  it('responde 504 NAO_CONFIRMADA quando o Motor não confirma no prazo', async () => {
    enviarEAguardar.mockRejectedValue(new ComandoNaoConfirmado(ordemValida.clientOrderId));

    const res = await postar(ordemValida);

    expect(res.status).toBe(504);
    expect(res.body.erro.codigo).toBe('NAO_CONFIRMADA');
  });

  it('responde 503 MERCADO_INDISPONIVEL quando o Redis está fora', async () => {
    enviarEAguardar.mockRejectedValue(new BarramentoIndisponivel(new Error('ECONNREFUSED')));

    const res = await postar(ordemValida);

    expect(res.status).toBe(503);
    expect(res.body.erro.codigo).toBe('MERCADO_INDISPONIVEL');
  });

  it('responde 500 sem detalhe para outra falha do barramento', async () => {
    enviarEAguardar.mockRejectedValue(new Error('redis: senha errada'));

    const res = await postar(ordemValida);

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('senha');
  });
});
