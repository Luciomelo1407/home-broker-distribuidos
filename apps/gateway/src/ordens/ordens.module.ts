import { Module } from '@nestjs/common';
import { OrdensController } from './ordens.controller';
import { OrdensService } from './ordens.service';

/**
 * `POST /ordens` (RF-009 a RF-011). Precisa de um provider de `BarramentoDeOrdens`,
 * que vem do `BusModule` (global) do Dev 2.
 */
@Module({
  controllers: [OrdensController],
  providers: [OrdensService],
})
export class OrdensModule {}
