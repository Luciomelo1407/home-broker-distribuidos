import type { OrdemRespostaDto } from '@bolsa/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
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

  /** RF-011: status de uma ordem própria. */
  @Get(':id')
  consultar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<OrdemRespostaDto> {
    return this.ordens.consultar(usuario, id);
  }

  /** RF-012: cancela o restante de uma ordem própria e devolve a ordem CANCELADA. */
  @Delete(':id')
  cancelar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<OrdemRespostaDto> {
    return this.ordens.cancelar(usuario, id);
  }
}
