import { Module } from '@nestjs/common';
import { LivroService } from './livro.service';
import { MercadoController } from './mercado.controller';
import { MercadoService } from './mercado.service';

/** `GET /mercado`, o livro (RF-007) e o snapshot em memória usado pelo `realtime`. */
@Module({
  controllers: [MercadoController],
  providers: [MercadoService, LivroService],
  exports: [MercadoService, LivroService],
})
export class MercadoModule {}
