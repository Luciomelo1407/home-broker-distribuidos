import type { CarteiraRespostaDto, OrdemResumoDto } from '@bolsa/contracts';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AppError, CodigoErro } from '../common/app-error';
import { DatabaseService } from '../database/database.service';
import { buscarCarteira, listarOrdensAbertas } from './carteira.queries';

@Injectable()
export class CarteiraService {
  constructor(private readonly db: DatabaseService) {}

  /** RF-005 (P1): saldo disponível, reservado e posições do investidor do token. */
  async carteira(investidorId: number): Promise<CarteiraRespostaDto> {
    const carteira = await buscarCarteira(this.db, investidorId);
    if (!carteira) {
      // Token válido de um investidor que não existe mais (ex.: banco recriado)
      throw new AppError(
        CodigoErro.NAO_AUTENTICADO,
        HttpStatus.UNAUTHORIZED,
        'investidor não encontrado',
      );
    }
    return carteira;
  }

  /** Ordens no livro do investidor (RF-004). */
  ordensAbertas(investidorId: number): Promise<OrdemResumoDto[]> {
    return listarOrdensAbertas(this.db, investidorId);
  }
}
