import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const HEADER_REQUEST_ID = 'x-request-id';

// Aceita o ID enviado pelo cliente só se for curto e sem caracteres estranhos (vai para o log).
const ID_VALIDO = /^[\w-]{1,64}$/;

/**
 * Devolve o ID da requisição, criando um se ainda não houver. O ID fica gravado no
 * próprio header da requisição, para que middleware, filtro e logger vejam o mesmo valor
 * (o filtro pode rodar sem o middleware, por exemplo quando o JSON do corpo é inválido).
 */
export function obterRequestId(req: IncomingMessage): string {
  const atual = req.headers[HEADER_REQUEST_ID];
  if (typeof atual === 'string' && ID_VALIDO.test(atual)) {
    return atual;
  }
  const novo = randomUUID();
  req.headers[HEADER_REQUEST_ID] = novo;
  return novo;
}

/** Garante um `x-request-id` em toda requisição e o devolve no header da resposta. */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: IncomingMessage, res: ServerResponse, next: () => void): void {
    res.setHeader(HEADER_REQUEST_ID, obterRequestId(req));
    next();
  }
}
