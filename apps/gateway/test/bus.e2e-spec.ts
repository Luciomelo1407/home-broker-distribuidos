import type { ComandoOrdem, ResultadoOrdem } from '@bolsa/contracts';
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { firstValueFrom } from 'rxjs';
import { BusService, CANAL_RESULTADO, STREAM_ORDENS } from '../src/bus/bus.service';
import { BarramentoIndisponivel, ComandoNaoConfirmado } from '../src/ordens/barramento-de-ordens';

// Precisa do Redis do compose (docker compose up -d --wait redis)
const URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
// Investidor que nunca existe: se o Motor real estiver de pé, ele descarta estes comandos
// em vez de criar ordens no banco, e só o Motor falso do teste responde
const INVESTIDOR_INEXISTENTE = 2_147_483_647;

function comando(): ComandoOrdem {
  return {
    tipo: 'CRIAR',
    clientOrderId: randomUUID(),
    investidorId: INVESTIDOR_INEXISTENTE,
    ativo: 'ABC3',
    lado: 'COMPRA',
    quantidade: 1,
    preco: '1.00',
  };
}

function resultadoPara(c: ComandoOrdem): ResultadoOrdem {
  return {
    clientOrderId: c.clientOrderId,
    investidorId: c.investidorId,
    ordem: null,
    motivoRejeicao: 'ORDEM_NAO_ENCONTRADA',
    ordensAtualizadas: [],
    negocios: [],
    mercado: [],
  };
}

describe('BusService contra o Redis real', () => {
  let motor: Redis;
  let bus: BusService;

  beforeAll(async () => {
    motor = new Redis(URL);
    bus = new BusService(
      new Redis(URL, { enableOfflineQueue: false, maxRetriesPerRequest: 0 }),
      new Redis(URL),
    );
    await bus.onModuleInit();
    await motor.ping();
  });

  afterAll(async () => {
    await bus.onApplicationShutdown();
    await motor.quit();
  });

  it('põe o comando no stream e resolve com o resultado do mesmo clientOrderId', async () => {
    const c = comando();
    const esperando = bus.enviarEAguardar(c, 2000);

    // Motor falso: lê a última entrada do stream e publica um resultado para ela
    await new Promise((r) => setTimeout(r, 50));
    const [[, campos]] = (await motor.xrevrange(STREAM_ORDENS, '+', '-', 'COUNT', 1)) as [
      [string, string[]],
    ];
    expect(campos[0]).toBe('payload');
    expect(JSON.parse(campos[1] ?? '')).toEqual(c);
    const outro = { ...resultadoPara(comando()), investidorId: 2 };
    await motor.publish(CANAL_RESULTADO, JSON.stringify(outro));
    await motor.publish(CANAL_RESULTADO, JSON.stringify(resultadoPara(c)));

    await expect(esperando).resolves.toEqual(resultadoPara(c));
  });

  it('repassa todo resultado em resultados$', async () => {
    const r = resultadoPara(comando());
    const proximo = firstValueFrom(bus.resultados$);

    await motor.publish(CANAL_RESULTADO, JSON.stringify(r));

    await expect(proximo).resolves.toEqual(r);
  });

  it('rejeita com ComandoNaoConfirmado quando o Motor não responde no prazo', async () => {
    await expect(bus.enviarEAguardar(comando(), 100)).rejects.toBeInstanceOf(ComandoNaoConfirmado);
  });

  it('rejeita com BarramentoIndisponivel quando o Redis está fora', async () => {
    const fora = new BusService(
      new Redis('redis://localhost:1', {
        enableOfflineQueue: false,
        maxRetriesPerRequest: 0,
        retryStrategy: () => null,
      }),
      new Redis('redis://localhost:1', { lazyConnect: true }),
    );
    fora['comandos'].on('error', () => undefined);

    await expect(fora.enviarEAguardar(comando(), 1000)).rejects.toBeInstanceOf(
      BarramentoIndisponivel,
    );
    fora['comandos'].disconnect();
  });
});
