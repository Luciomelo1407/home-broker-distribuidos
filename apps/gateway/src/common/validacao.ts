import { HttpStatus, ValidationError, ValidationPipe } from '@nestjs/common';
import { AppError, CodigoErro } from './app-error';

/**
 * Barreira 1 de validação (arquitetura §4.1, RNF-07). Campos fora do DTO são recusados,
 * e não descartados: é isso que impede um `userId` vindo no corpo (RNF-08, regra 3.3.3).
 */
export function criarValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (erros) => {
      const falhas = achatar(erros);
      return new AppError(
        CodigoErro.VALIDACAO,
        HttpStatus.BAD_REQUEST,
        falhas.flatMap((falha) => falha.mensagens).join('; '),
        falhas.map((falha) => falha.campo),
      );
    },
  });
}

interface Falha {
  campo: string;
  mensagens: string[];
}

// DTOs aninhados geram erros em árvore; o cliente recebe o caminho completo (ex.: itens.0.preco)
function achatar(erros: ValidationError[], prefixo = ''): Falha[] {
  return erros.flatMap((erro) => {
    const campo = prefixo + erro.property;
    const proprias: Falha[] = erro.constraints
      ? [{ campo, mensagens: Object.values(erro.constraints) }]
      : [];
    return [...proprias, ...achatar(erro.children ?? [], `${campo}.`)];
  });
}
