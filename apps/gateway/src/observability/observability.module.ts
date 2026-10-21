import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import type { AppConfig } from '../config/config.module';
import { opcoesDoLogger } from './logger';

/**
 * Logs estruturados do Gateway (RF-025, arquitetura §4.3). O `Logger` do Nest passa a
 * escrever pelo pino (ver main.ts), então `new Logger(Contexto)` continua valendo.
 * As métricas prom-client (RF-026) entram aqui na F6.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: AppConfig) => opcoesDoLogger(config.get('LOG_LEVEL', { infer: true })),
    }),
  ],
})
export class ObservabilityModule {}
