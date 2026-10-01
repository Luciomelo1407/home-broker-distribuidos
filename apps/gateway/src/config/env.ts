import { plainToInstance, Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

// Variáveis de ambiente vêm sempre como string. Converte só se houver valor, para que
// uma variável vazia falhe na validação em vez de virar 0.
const ParaInteiro = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value.trim() !== '' ? Number(value) : value,
  );

/**
 * Variáveis que o Gateway exige para subir (arquitetura §3.3, regra 9).
 * Nenhuma tem valor padrão: se faltar ou estiver errada, o processo não sobe.
 */
export class Env {
  @Matches(/^postgres(ql)?:\/\//, { message: 'deve ser uma URL postgres://' })
  GATEWAY_DATABASE_URL!: string;

  @Matches(/^rediss?:\/\//, { message: 'deve ser uma URL redis://' })
  REDIS_URL!: string;

  @ParaInteiro()
  @IsInt({ message: 'deve ser um número inteiro' })
  @Min(1)
  @Max(65535)
  GATEWAY_PORT!: number;

  @IsString()
  @MinLength(16, { message: 'deve ter pelo menos 16 caracteres' })
  JWT_SECRET!: string;

  // SD-04: validade do token, no formato aceito pela biblioteca de JWT (ex.: 8h, 30m)
  @IsString()
  @IsNotEmpty()
  JWT_EXPIRACAO!: string;

  // SD-04: quanto o POST /ordens espera pelo Motor antes de responder 504
  @ParaInteiro()
  @IsInt({ message: 'deve ser um número inteiro' })
  @Min(1)
  ORDEM_TIMEOUT_MS!: number;

  // S-01: dinheiro é string decimal, nunca número (arquitetura §3.3, regra 1)
  @Matches(/^\d+(\.\d{1,2})?$/, { message: 'deve ser decimal com até 2 casas (ex.: 100000.00)' })
  SALDO_INICIAL!: string;

  // S-01: ações de cada ativo que um investidor recebe no cadastro
  @ParaInteiro()
  @IsInt({ message: 'deve ser um número inteiro' })
  @Min(0)
  ACOES_INICIAIS!: number;
}

/**
 * Valida o ambiente ao subir. A mensagem de erro lista os nomes das variáveis com
 * problema, mas nunca os valores, para não vazar segredos no log.
 */
export function validarEnv(config: Record<string, unknown>): Env {
  const env = plainToInstance(Env, config);
  const erros = validateSync(env);
  if (erros.length > 0) {
    const linhas = erros.map(
      (erro) => `  - ${erro.property}: ${Object.values(erro.constraints ?? {}).join('; ')}`,
    );
    throw new Error(`Variáveis de ambiente inválidas:\n${linhas.join('\n')}`);
  }
  return env;
}
