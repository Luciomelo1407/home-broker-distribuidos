import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import type { AppConfig } from '../config/config.module';
import { DatabaseService, PG_POOL } from './database.service';

const logger = new Logger('DatabaseModule');

/** Um único pool para o Gateway inteiro. Os módulos injetam o DatabaseService. */
@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (config: AppConfig): Pool => {
        const pool = new Pool({
          connectionString: config.get('GATEWAY_DATABASE_URL', { infer: true }),
          max: 10,
        });
        // Sem este listener, a queda de uma conexão ociosa derruba o processo
        pool.on('error', (erro) => logger.error(`conexão ociosa do pool falhou: ${erro.message}`));
        return pool;
      },
    },
    DatabaseService,
  ],
  exports: [DatabaseService],
})
export class DatabaseModule {}
