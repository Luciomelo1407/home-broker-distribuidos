import type { MercadoRespostaDto } from '@bolsa/contracts';
import { Controller, Get } from '@nestjs/common';
import { MercadoService } from './mercado.service';

@Controller('mercado')
export class MercadoController {
  constructor(private readonly mercado: MercadoService) {}

  /** RF-006: o mesmo mercado para todos, então não depende de quem pergunta. */
  @Get()
  listar(): MercadoRespostaDto {
    return this.mercado.listar();
  }
}
