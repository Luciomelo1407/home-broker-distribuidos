import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { AppConfig } from '../config/config.module';
import { BarramentoDeOrdens } from '../ordens/barramento-de-ordens';
import { BusService, REDIS_ASSINATURA, REDIS_COMANDOS } from './bus.service';

const logger = new Logger('BusModule');

function conectar(config: AppConfig, nome: string, opcoes: { falharRapido: boolean }): Redis {
  const redis = new Redis(config.get('REDIS_URL', { infer: true }), {
    connectionName: `gateway-${nome}`,
    // Com o Redis fora, o POST /ordens responde 503 na hora em vez de esperar a reconexão
    ...(opcoes.falharRapido ? { enableOfflineQueue: false, maxRetriesPerRequest: 0 } : {}),
  });
  // Sem este listener, a queda do Redis derruba o processo; o ioredis reconecta sozinho
  redis.on('error', (erro) => logger.warn(`Redis (${nome}): ${erro.message}`));
  return redis;
}

/**
 * Redis do Gateway (docs/integracao.md §1). Global porque `ordens` (envio) e `realtime`
 * (resultados e presença) usam as mesmas conexões.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_COMANDOS,
      inject: [ConfigService],
      useFactory: (config: AppConfig) => conectar(config, 'comandos', { falharRapido: true }),
    },
    {
      provide: REDIS_ASSINATURA,
      inject: [ConfigService],
      useFactory: (config: AppConfig) => conectar(config, 'assinatura', { falharRapido: false }),
    },
    BusService,
    { provide: BarramentoDeOrdens, useExisting: BusService },
  ],
  exports: [BusService, BarramentoDeOrdens, REDIS_COMANDOS],
})
export class BusModule {}
