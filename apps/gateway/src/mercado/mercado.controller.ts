import type { MercadoRespostaDto } from '@bolsa/contracts';
import { Controller, Get, HttpStatus, Param } from '@nestjs/common';
import { AppError, CodigoErro } from '../common/app-error';
import { LivroService } from './livro.service';
import type { LivroDto } from './mercado.queries';
import { MercadoService } from './mercado.service';

@Controller('mercado')
export class MercadoController {
  constructor(
    private readonly mercado: MercadoService,
    private readonly livros: LivroService,
  ) {}

  /** RF-006: o mesmo mercado para todos, então não depende de quem pergunta. */
  @Get()
  listar(): MercadoRespostaDto {
    return this.mercado.listar();
  }

  /** RF-007: os 5 melhores níveis de compra e de venda do ativo, agregados por preço. */
  @Get('livro/:ativo')
  livro(@Param('ativo') ativo: string): LivroDto {
    const livro = this.livros.livro(ativo);
    if (!livro) {
      throw new AppError(CodigoErro.NAO_ENCONTRADO, HttpStatus.NOT_FOUND, 'ativo inexistente');
    }
    return livro;
  }
}
