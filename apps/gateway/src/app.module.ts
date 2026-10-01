import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';

// Módulo raiz. Os módulos por área (auth, ordens, carteira, mercado, realtime, bus…)
// são registrados aqui conforme forem criados (arquitetura §2).
@Module({
  imports: [AppConfigModule, CommonModule, DatabaseModule],
})
export class AppModule {}
