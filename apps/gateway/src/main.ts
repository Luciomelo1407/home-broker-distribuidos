import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import type { AppConfig } from './config/config.module';

async function bootstrap(): Promise<void> {
  // abortOnError: false para que erro de configuração ou de banco saia com código 1
  // e mensagem legível, em vez de process.abort()
  // bufferLogs: os logs da subida esperam o pino ficar pronto, em vez de sair em texto
  const app = await NestFactory.create(AppModule, { abortOnError: false, bufferLogs: true });
  app.useLogger(app.get(Logger));
  // O Home Broker é servido em outra porta. Qualquer origem é aceita porque a sessão é
  // um JWT no header Authorization, não cookie: outro site não tem como usá-la
  app.enableCors({ origin: true, exposedHeaders: ['x-request-id'] });
  app.enableShutdownHooks();
  const config = app.get<AppConfig>(ConfigService);
  await app.listen(config.get('GATEWAY_PORT', { infer: true }));
}

bootstrap().catch((erro: unknown) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
