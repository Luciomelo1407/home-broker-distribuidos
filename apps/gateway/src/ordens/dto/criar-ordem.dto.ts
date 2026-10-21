import type { CriarOrdemRequisicaoDto, LadoOrdem } from '@bolsa/contracts';
import { IsIn, IsInt, IsString, IsUUID, Matches, Max, Min } from 'class-validator';

// Maior quantidade que cabe em `ordens.quantidade` (integer do Postgres)
const QUANTIDADE_MAXIMA = 2_147_483_647;

/**
 * Corpo do `POST /ordens` (contrato `CriarOrdemRequisicao`), barreira 1 de validação
 * (arquitetura §4.1, RNF-07). Não existe campo de investidor: ele vem do JWT, e um
 * `investidorId`/`userId` no corpo é recusado pelo `forbidNonWhitelisted` (RNF-08).
 */
export class CriarOrdemDto implements CriarOrdemRequisicaoDto {
  @IsUUID('all', { message: 'clientOrderId deve ser um UUID' })
  clientOrderId!: string;

  @IsString({ message: 'ativo deve ser texto' })
  @Matches(/^[A-Z]{3,4}\d{1,2}$/, { message: 'ativo deve ser um código como ABC3' })
  ativo!: string;

  @IsIn(['COMPRA', 'VENDA'], { message: 'lado deve ser COMPRA ou VENDA' })
  lado!: LadoOrdem;

  @IsInt({ message: 'quantidade deve ser inteira' })
  @Min(1, { message: 'quantidade deve ser maior que zero' })
  @Max(QUANTIDADE_MAXIMA, { message: 'quantidade grande demais' })
  quantidade!: number;

  // Dinheiro é string decimal (regra 3.3.1). Cabe em decimal(15,2) e é maior que zero.
  @IsString({ message: 'preco deve ser texto, como "35.50"' })
  @Matches(/^(?!0+(\.0{1,2})?$)\d{1,13}(\.\d{1,2})?$/, {
    message: 'preco deve ser decimal maior que zero com até 2 casas, como "35.50"',
  })
  preco!: string;
}
