import type { AuthCadastroRequisicaoDto, AuthLoginRequisicaoDto } from '@bolsa/contracts';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** Corpo de `POST /auth/cadastro` e `POST /auth/login` (contrato `AuthCadastroRequisicao`). */
export class CredenciaisDto implements AuthCadastroRequisicaoDto, AuthLoginRequisicaoDto {
  @IsString({ message: 'nomeUsuario deve ser texto' })
  @MinLength(3, { message: 'nomeUsuario deve ter pelo menos 3 caracteres' })
  @MaxLength(50, { message: 'nomeUsuario deve ter no máximo 50 caracteres' })
  @Matches(/^[\w.-]+$/, { message: 'nomeUsuario aceita só letras, números, ponto, hífen e _' })
  nomeUsuario!: string;

  @IsString({ message: 'senha deve ser texto' })
  @MinLength(6, { message: 'senha deve ter pelo menos 6 caracteres' })
  @MaxLength(100, { message: 'senha deve ter no máximo 100 caracteres' })
  senha!: string;
}
