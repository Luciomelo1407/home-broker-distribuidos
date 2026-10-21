import { createParamDecorator, ExecutionContext, HttpStatus } from '@nestjs/common';
import { AppError, CodigoErro } from './app-error';

/** O investidor autenticado. O `id` vem só do JWT, nunca do corpo (RNF-08, regra 3.3.3). */
export interface UsuarioAutenticado {
  id: number;
}

/** Requisição depois do guard de autenticação, que preenche `usuario` a partir do JWT. */
export interface RequisicaoAutenticada {
  usuario?: UsuarioAutenticado;
}

/**
 * Injeta o investidor autenticado no handler: `criar(@UsuarioAtual() usuario, ...)`.
 * Quem preenche `req.usuario` é o guard do `auth` (Dev 4). Sem ele, a rota responde
 * 401: uma rota que usa este decorator nunca roda sem investidor.
 */
export const UsuarioAtual = createParamDecorator(
  (_dados: unknown, contexto: ExecutionContext): UsuarioAutenticado => {
    const usuario = contexto.switchToHttp().getRequest<RequisicaoAutenticada>().usuario;
    if (!usuario) {
      throw new AppError(
        CodigoErro.NAO_AUTENTICADO,
        HttpStatus.UNAUTHORIZED,
        'token ausente ou inválido',
      );
    }
    return usuario;
  },
);
