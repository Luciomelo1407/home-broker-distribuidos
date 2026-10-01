import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { FiltroDeErros } from './filtro-de-erros';
import { RequestIdMiddleware } from './request-id';
import { criarValidationPipe } from './validacao';

/**
 * Comportamento comum a todas as rotas: request id, validação dos DTOs e formato de erro.
 * Registrado como provider (e não no main.ts) para valer também nos testes e2e.
 */
@Module({
  providers: [
    { provide: APP_FILTER, useClass: FiltroDeErros },
    { provide: APP_PIPE, useFactory: criarValidationPipe },
  ],
})
export class CommonModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*path');
  }
}
