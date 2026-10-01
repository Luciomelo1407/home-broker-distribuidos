import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import type { AppConfig } from './config/config.module';

async function bootstrap(): Promise<void> {
  // abortOnError: false para que erro de configuração ou de banco saia com código 1
  // e mensagem legível, em vez de process.abort()
  const app = await NestFactory.create(AppModule, { abortOnError: false });
  app.enableShutdownHooks();
  const config = app.get<AppConfig>(ConfigService);
  await app.listen(config.get('GATEWAY_PORT', { infer: true }));
}

bootstrap().catch((erro: unknown) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
