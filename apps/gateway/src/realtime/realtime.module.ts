import { Module } from '@nestjs/common';
import { CarteiraModule } from '../carteira/carteira.module';
import { MercadoModule } from '../mercado/mercado.module';
import { RealtimeService } from './realtime.service';

/** WebSocket `/ws` (RF-003, RF-004, RF-018, RF-023). */
@Module({
  imports: [CarteiraModule, MercadoModule],
  providers: [RealtimeService],
})
export class RealtimeModule {}
