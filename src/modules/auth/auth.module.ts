import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { MfaGuard } from '../../common/guards/mfa.guard.js';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { MfaService } from './mfa.service.js';
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
    MfaService,
    // Urutan penting: rate limit dulu (per-IP, sebelum kerja berat) → auth → role → MFA.
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: MfaGuard },
  ],
  exports: [AuthService, TokenService, MfaService],
})
export class AuthModule {}
