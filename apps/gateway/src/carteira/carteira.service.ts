import type { CarteiraRespostaDto, HistoricoRespostaDto, OrdemResumoDto } from '@bolsa/contracts';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AppError, CodigoErro } from '../common/app-error';
import { DatabaseService } from '../database/database.service';
import { buscarCarteira, buscarHistorico, listarOrdensAbertas } from './carteira.queries';

@Injectable()
export class CarteiraService {
  constructor(private readonly db: DatabaseService) {}

  /** RF-005: saldo, posições, patrimônio e P/L do investidor do token. */
  async carteira(investidorId: number): Promise<CarteiraRespostaDto> {
    const carteira = await this.db.transacao(async (cliente) => {
      // RF-005/RNF-01: saldo, posições e totais pertencem ao mesmo estado do banco.
      await cliente.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      return buscarCarteira(cliente, investidorId);
    });
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

  /** RF-008: ordens e negócios do investidor do token. */
  historico(investidorId: number): Promise<HistoricoRespostaDto> {
    return this.db.transacao(async (cliente) => {
      await cliente.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      return buscarHistorico(cliente, investidorId);
    });
  }
}
