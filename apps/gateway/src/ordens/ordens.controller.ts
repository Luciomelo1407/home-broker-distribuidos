import type { OrdemRespostaDto } from '@bolsa/contracts';
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { UsuarioAtual, type UsuarioAutenticado } from '../common/usuario-atual';
import { CriarOrdemDto } from './dto/criar-ordem.dto';
import { OrdensService } from './ordens.service';

@Controller('ordens')
export class OrdensController {
  constructor(private readonly ordens: OrdensService) {}

  /** RF-009/RF-010: responde só depois do Motor, com a ordem aceita ou rejeitada (201). */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  criar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Body() dto: CriarOrdemDto,
  ): Promise<OrdemRespostaDto> {
    return this.ordens.criar(usuario, dto);
  }
}
