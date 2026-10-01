import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AppError, CodigoErro } from './app-error';
import { HEADER_REQUEST_ID, obterRequestId } from './request-id';

interface CorpoDeErro {
  erro: { codigo: CodigoErro; mensagem: string; campos?: string[] };
  requestId: string;
}

interface ErroTraduzido {
  status: number;
  codigo: CodigoErro;
  mensagem: string;
  campos?: string[];
}

/**
 * Filtro global único (arquitetura §4.2): toda exceção de uma rota REST sai no formato
 * `{ erro: { codigo, mensagem, campos? }, requestId }`. Exceções desconhecidas viram
 * 500 ERRO_INTERNO, com o detalhe só no log, nunca na resposta.
 */
@Catch()
export class FiltroDeErros implements ExceptionFilter {
  private readonly logger = new Logger(FiltroDeErros.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    // WebSocket tem formato próprio (`{ tipo: 'ERRO' }`), tratado em realtime
    if (host.getType() !== 'http') {
      this.logger.error(exception);
      return;
    }

    const http = host.switchToHttp();
    const req = http.getRequest<IncomingMessage>();
    const res = http.getResponse<ServerResponse>();
    const requestId = obterRequestId(req);
    const { status, codigo, mensagem, campos } = this.traduzir(exception);

    if (status >= 500) {
      this.logger.error(
        { requestId, metodo: req.method, rota: req.url, codigo },
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const corpo: CorpoDeErro = {
      erro: campos ? { codigo, mensagem, campos } : { codigo, mensagem },
      requestId,
    };
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader(HEADER_REQUEST_ID, requestId);
    res.end(JSON.stringify(corpo));
  }

  private traduzir(exception: unknown): ErroTraduzido {
    if (exception instanceof AppError) {
      return {
        status: exception.httpStatus,
        codigo: exception.codigo,
        mensagem: exception.message,
        campos: exception.campos,
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status < 500) {
        return { status, codigo: codigoPorStatus(status), mensagem: exception.message };
      }
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      codigo: CodigoErro.ERRO_INTERNO,
      mensagem: 'erro interno',
    };
  }
}

/** Código para as exceções HTTP lançadas pelo Nest, e não pelos nossos services. */
function codigoPorStatus(status: number): CodigoErro {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return CodigoErro.VALIDACAO;
    case HttpStatus.UNAUTHORIZED:
      return CodigoErro.NAO_AUTENTICADO;
    case HttpStatus.FORBIDDEN:
      return CodigoErro.ACESSO_NEGADO;
    case HttpStatus.NOT_FOUND:
      return CodigoErro.NAO_ENCONTRADO;
    default:
      return CodigoErro.REQUISICAO_INVALIDA;
  }
}
