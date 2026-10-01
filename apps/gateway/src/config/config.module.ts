import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Env, validarEnv } from './env';

/**
 * Acesso tipado às variáveis já validadas:
 * `config.get('ORDEM_TIMEOUT_MS', { infer: true })` devolve `number`.
 */
export type AppConfig = ConfigService<Env, true>;

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Fora do Docker, o .env fica na raiz do monorepo e o processo roda em apps/gateway.
      // Variáveis já definidas no ambiente (compose) têm prioridade sobre o arquivo.
      envFilePath: ['.env', '../../.env'],
      validate: validarEnv,
    }),
  ],
})
export class AppConfigModule {}
