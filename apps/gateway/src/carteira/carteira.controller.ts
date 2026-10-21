import type { CarteiraRespostaDto, HistoricoRespostaDto } from '@bolsa/contracts';
import { Controller, Get } from '@nestjs/common';
import { UsuarioAtual, type UsuarioAutenticado } from '../common/usuario-atual';
import { CarteiraService } from './carteira.service';

@Controller()
export class CarteiraController {
  constructor(private readonly carteira: CarteiraService) {}

  /** RF-005: só a carteira de quem está logado (RNF-08). */
  @Get('carteira')
  buscar(@UsuarioAtual() usuario: UsuarioAutenticado): Promise<CarteiraRespostaDto> {
    return this.carteira.carteira(usuario.id);
  }

  /** RF-008: histórico de ordens e negócios de quem está logado. */
  @Get('historico')
  historico(@UsuarioAtual() usuario: UsuarioAutenticado): Promise<HistoricoRespostaDto> {
    return this.carteira.historico(usuario.id);
  }
}
