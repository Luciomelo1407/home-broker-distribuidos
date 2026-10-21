import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import type { AppConfig } from '../config/config.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtGuard } from './jwt.guard';

/**
 * Cadastro, login e JWT (RF-001, RF-002, RNF-06). Global porque o `realtime` usa
 * `AuthService.verificar` para autenticar o WebSocket.
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: AppConfig) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: {
          // SD-04: formato aceito pelo jsonwebtoken (8h, 30m…)
          expiresIn: config.get('JWT_EXPIRACAO', { infer: true }) as `${number}h`,
          algorithm: 'HS256',
        },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, { provide: APP_GUARD, useClass: JwtGuard }],
  exports: [AuthService],
})
export class AuthModule {}
