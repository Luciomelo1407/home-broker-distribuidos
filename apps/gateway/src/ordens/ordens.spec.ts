import type { ComandoOrdem, OrdemRespostaDto, ResultadoOrdem } from '@bolsa/contracts';
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

const enviarEAguardar = jest.fn<Promise<ResultadoOrdem>, [ComandoOrdem, number]>();

@Global()
@Module({
  providers: [
    {
      provide: DatabaseService,
      // Ativos para a checagem do POST; ordens do banco para GET/DELETE /ordens/:id
      useValue: {
        query: async (sql: string, params?: unknown[]) =>
          sql.includes('FROM ordens')
            ? { rows: ordensNoBanco.filter((o) => String(o.id) === String(params?.[0])) }
            : { rows: [{ codigo: 'ABC3' }, { codigo: 'DEF4' }] },
      },
    },
    { provide: BarramentoDeOrdens, useValue: { enviarEAguardar } },
    { provide: ConfigService, useValue: { get: () => 3000 } },
    { provide: APP_GUARD, useClass: GuardDeTeste },
  ],
  exports: [DatabaseService, BarramentoDeOrdens, ConfigService],
})
class DependenciasFalsas {}

// Ordem 42 é do investidor 7 (o do token nos testes); a 43 é do investidor 8
const ordensNoBanco: OrdemRespostaDto[] = [42, 43].map((id) => ({
  id,
  clientOrderId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  investidorId: id === 42 ? 7 : 8,
  ativo: 'ABC3',
  lado: 'COMPRA',
  precoLimite: '25.50',
  quantidade: 100,
  quantidadeExecutada: 0,
  status: 'ABERTA',
}));

const ordemValida = {
  clientOrderId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  ativo: 'ABC3',
  lado: 'COMPRA',
  quantidade: 100,
  preco: '25.50',
};

function resultado(ordem: OrdemRespostaDto): ResultadoOrdem {
  return {
    clientOrderId: ordem.clientOrderId,
    investidorId: ordem.investidorId,
    ordem,
    ordensAtualizadas: [ordem],
    negocios: [],
    mercado: [],
  };
}

function respostaDoMotor(comando: ComandoOrdem): OrdemRespostaDto {
  if (comando.tipo !== 'CRIAR') throw new Error('o POST só manda CRIAR');
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
    enviarEAguardar.mockImplementation(async (comando) => resultado(respostaDoMotor(comando)));
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
    enviarEAguardar.mockImplementation(async (comando) =>
      resultado({
        ...respostaDoMotor(comando),
        status: 'REJEITADA',
        motivoRejeicao: 'SALDO_INSUFICIENTE',
      }),
    );

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

describe('GET e DELETE /ordens/:id', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [DependenciasFalsas, CommonModule, OrdensModule],
    }).compile();
    app = modulo.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(() => app.close());

  beforeEach(() => enviarEAguardar.mockReset());

  const como = (metodo: 'get' | 'delete', caminho: string, usuario = '7') =>
    request(app.getHttpServer())[metodo](caminho).set('x-teste-usuario', usuario);

  it('GET devolve a ordem do próprio investidor (RF-011)', async () => {
    const res = await como('get', '/ordens/42');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 42, investidorId: 7, status: 'ABERTA' });
  });

  it.each([
    ['get', 403, 'ORDEM_DE_OUTRO_INVESTIDOR', '/ordens/43'],
    ['delete', 403, 'ORDEM_DE_OUTRO_INVESTIDOR', '/ordens/43'],
    ['get', 404, 'NAO_ENCONTRADO', '/ordens/999'],
    ['delete', 404, 'NAO_ENCONTRADO', '/ordens/999'],
    ['get', 400, 'VALIDACAO', '/ordens/abc'],
  ] as const)(
    'T-10: %s %s → %i %s, sem falar com o Motor',
    async (metodo, status, codigo, caminho) => {
      const res = await como(metodo, caminho);

      expect(res.status).toBe(status);
      expect(res.body.erro.codigo).toBe(codigo);
      expect(enviarEAguardar).not.toHaveBeenCalled();
    },
  );

  it('DELETE manda CANCELAR com o investidor do token e devolve a ordem cancelada', async () => {
    const cancelada = { ...(ordensNoBanco[0] as OrdemRespostaDto), status: 'CANCELADA' as const };
    enviarEAguardar.mockImplementation(async (comando) => ({
      ...resultado(cancelada),
      clientOrderId: comando.clientOrderId,
    }));

    const res = await como('delete', '/ordens/42');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CANCELADA');
    expect(enviarEAguardar).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: 'CANCELAR', investidorId: 7, ordemId: 42 }),
      3000,
    );
  });

  it.each([
    ['ORDEM_NAO_CANCELAVEL', 409, 'ORDEM_NAO_CANCELAVEL'],
    ['ORDEM_DE_OUTRO_INVESTIDOR', 403, 'ORDEM_DE_OUTRO_INVESTIDOR'],
    ['ORDEM_NAO_ENCONTRADA', 404, 'NAO_ENCONTRADO'],
    ['COMANDO_EXPIRADO', 504, 'NAO_CONFIRMADA'],
  ] as const)('DELETE recusado pelo Motor com %s → %i', async (motivo, status, codigo) => {
    enviarEAguardar.mockImplementation(async (comando) => ({
      clientOrderId: comando.clientOrderId,
      investidorId: 7,
      ordem: motivo === 'ORDEM_NAO_CANCELAVEL' ? (ordensNoBanco[0] as OrdemRespostaDto) : null,
      motivoRejeicao: motivo,
      ordensAtualizadas: [],
      negocios: [],
      mercado: [],
    }));

    const res = await como('delete', '/ordens/42');

    expect(res.status).toBe(status);
    expect(res.body.erro.codigo).toBe(codigo);
  });
});
