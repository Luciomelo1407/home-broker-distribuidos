import { Module } from '@nestjs/common';
import { OrdensController } from './ordens.controller';
import { OrdensService } from './ordens.service';

/** `POST /ordens` (RF-009 a RF-011). O `BarramentoDeOrdens` vem do `BusModule` (global). */
@Module({
  controllers: [OrdensController],
  providers: [OrdensService],
})
export class OrdensModule {}
