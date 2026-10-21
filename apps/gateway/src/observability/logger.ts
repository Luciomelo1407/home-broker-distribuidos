import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import { obterRequestId } from '../common/request-id';

/**
 * Caminhos que nunca vão para o log (arquitetura §4.3): o token, a senha e qualquer
 * campo `token`/`senha` em um nível de profundidade (corpo de /auth, resposta do login).
 */
export const CAMPOS_OCULTOS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'senha',
  'token',
  '*.senha',
  '*.token',
  '*.senhaHash',
];

/**
 * Configuração do pino (arquitetura §4.3): JSON em uma linha por evento, em stdout, com
 * `ts`, `level` como texto, `service` e o `requestId` gerado pelo `common/request-id`.
 * `destino` existe para os testes lerem o que foi escrito; o padrão é stdout.
 */
export function opcoesDoLogger(nivel: string, destino?: DestinationStream): Params {
  const opcoes = {
    level: nivel,
    base: { service: 'gateway' },
    timestamp: () => `,"ts":"${new Date().toISOString()}"`,
    formatters: { level: (label) => ({ level: label }) },
    redact: { paths: CAMPOS_OCULTOS, censor: '[oculto]' },
    // O mesmo ID que o middleware devolve no header e o filtro coloca no corpo do erro
    genReqId: (req: IncomingMessage) => obterRequestId(req),
    customProps: (req: IncomingMessage) => ({ requestId: obterRequestId(req) }),
    // Só o necessário da requisição: o corpo nunca é logado (senhas em /auth)
    serializers: {
      req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
    customLogLevel: (_req: IncomingMessage, res: ServerResponse, erro?: Error) => {
      if (erro || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
  } satisfies NonNullable<Params['pinoHttp']>;
  return { pinoHttp: destino ? [opcoes, destino] : opcoes };
}
