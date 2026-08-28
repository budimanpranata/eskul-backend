import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { TokenService } from './token.service.js';

/**
 * Autentikasi & RBAC (Fase 1.1).
 *
 * Mendaftarkan JwtAuthGuard + RolesGuard sebagai guard GLOBAL (urutan penting:
 * autentikasi dulu, baru cek role). Route publik memakai @Public().
 */
@Module({
  imports: [JwtModule.register({})], // secret di-pass per-operasi via ConfigService
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
