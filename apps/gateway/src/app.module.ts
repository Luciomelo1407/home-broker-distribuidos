import { Module } from '@nestjs/common';

// Módulo raiz. Os módulos por área (auth, ordens, carteira, mercado, realtime, bus…)
// são registrados aqui conforme forem criados (arquitetura §2).
@Module({})
export class AppModule {}
