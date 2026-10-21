import { Module } from '@nestjs/common';
import { MercadoController } from './mercado.controller';
import { MercadoService } from './mercado.service';

/** `GET /mercado` e o snapshot em memória usado pelo `realtime` (RF-006, RF-017). */
@Module({
  controllers: [MercadoController],
  providers: [MercadoService],
  exports: [MercadoService],
})
export class MercadoModule {}
