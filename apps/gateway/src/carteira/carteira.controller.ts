import type { CarteiraRespostaDto } from '@bolsa/contracts';
import { Controller, Get } from '@nestjs/common';
import { UsuarioAtual, type UsuarioAutenticado } from '../common/usuario-atual';
import { CarteiraService } from './carteira.service';

@Controller('carteira')
export class CarteiraController {
  constructor(private readonly carteira: CarteiraService) {}

  /** RF-005: só a carteira de quem está logado (RNF-08). */
  @Get()
  buscar(@UsuarioAtual() usuario: UsuarioAutenticado): Promise<CarteiraRespostaDto> {
    return this.carteira.carteira(usuario.id);
  }
}
