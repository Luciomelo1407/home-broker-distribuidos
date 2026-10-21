import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { BusModule } from './bus/bus.module';
import { CommonModule } from './common/common.module';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { MercadoModule } from './mercado/mercado.module';
import { ObservabilityModule } from './observability/observability.module';
import { OrdensModule } from './ordens/ordens.module';

// Módulo raiz. Os módulos por área (auth, ordens, carteira, mercado, realtime, bus…)
// são registrados aqui conforme forem criados (arquitetura §2).
@Module({
  imports: [
    AppConfigModule,
    ObservabilityModule,
    CommonModule,
    DatabaseModule,
    BusModule,
    AuthModule,
    MercadoModule,
    OrdensModule,
  ],
})
export class AppModule {}
