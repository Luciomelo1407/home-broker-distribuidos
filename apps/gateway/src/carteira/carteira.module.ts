import { Module } from '@nestjs/common';
import { CarteiraController } from './carteira.controller';
import { CarteiraService } from './carteira.service';

/** `GET /carteira` (RF-005, P1) e as consultas do SNAPSHOT do `realtime`. */
@Module({
  controllers: [CarteiraController],
  providers: [CarteiraService],
  exports: [CarteiraService],
})
export class CarteiraModule {}
