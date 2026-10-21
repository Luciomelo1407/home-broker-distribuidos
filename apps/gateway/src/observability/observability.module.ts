import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import type { AppConfig } from '../config/config.module';
import { opcoesDoLogger } from './logger';
import { MetricasController } from './metricas.controller';
import { MetricasService } from './metricas.service';

/**
 * Logs estruturados (RF-025, arquitetura §4.3) e métricas (RF-026) do Gateway. O `Logger`
 * do Nest passa a escrever pelo pino (ver main.ts), então `new Logger(Contexto)` continua
 * valendo. Global para que qualquer módulo registre métricas pelo `MetricasService`.
 */
@Global()
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: AppConfig) => opcoesDoLogger(config.get('LOG_LEVEL', { infer: true })),
    }),
  ],
  controllers: [MetricasController],
  providers: [MetricasService],
  exports: [MetricasService],
})
export class ObservabilityModule {}
