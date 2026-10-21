import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import type { RequisicaoAutenticada } from '../common/usuario-atual';
import { AuthService } from './auth.service';

/**
 * Guard global de REST: lê `Authorization: Bearer <jwt>` e, se o token for válido,
 * preenche `req.usuario`. Não recusa nada sozinho: quem exige login é o `@UsuarioAtual()`,
 * que responde 401 sem `req.usuario` (docs/integracao.md §4). Assim `/auth/*` e
 * `/mercado` continuam abertos sem lista de exceções.
 */
@Injectable()
export class JwtGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    if (contexto.getType() !== 'http') return true;
    const req = contexto.switchToHttp().getRequest<IncomingMessage & RequisicaoAutenticada>();
    const [tipo, token] = (req.headers.authorization ?? '').split(' ');
    if (tipo === 'Bearer') {
      req.usuario = await this.auth.verificar(token);
    }
    return true;
  }
}
