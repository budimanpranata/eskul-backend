import { Body, Controller, Get, HttpCode, Ip, Post } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { MfaExempt } from '../../common/decorators/mfa-exempt.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { MfaCodeDto, MfaLoginDto } from './dto/mfa.dto.js';
import { RefreshDto } from './dto/refresh.dto.js';
import { RegisterParentDto } from './dto/register-parent.dto.js';

/**
 * Autentikasi — dokumen desain bagian 4.3.
 *  POST /auth/login        (publik)  password → sesi ATAU tantangan MFA (admin ber-MFA)
 *  POST /auth/login/mfa    (publik)  token tantangan + kode TOTP/recovery → sesi
 *  POST /auth/refresh      (publik)  rotasi token
 *  POST /auth/logout       (auth)    cabut seluruh sesi refresh
 *  GET  /auth/me           (auth)    profil
 *  /auth/mfa/*             (auth, ADMIN*) setup & pengelolaan MFA (Fase 4.2)
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @RateLimit({ limit: 8, windowSeconds: 60, scope: 'auth:login' })
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Ip() ip: string) {
    return this.authService.login(dto, ip ?? null);
  }

  @Public()
  @RateLimit({ limit: 10, windowSeconds: 60, scope: 'auth:login-mfa' })
  @Post('login/mfa')
  @HttpCode(200)
  loginMfa(@Body() dto: MfaLoginDto, @Ip() ip: string) {
    return this.authService.completeMfaLogin(dto.mfaToken, dto.code, ip ?? null);
  }

  @Public()
  @RateLimit({ limit: 30, windowSeconds: 60, scope: 'auth:refresh' })
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto, @Ip() ip: string) {
    return this.authService.refresh(dto.refreshToken, ip ?? null);
  }

  /** Pendaftaran mandiri Orang Tua (dokumen desain 5.2). */
  @Public()
  @RateLimit({ limit: 5, windowSeconds: 3600, scope: 'auth:register' })
  @Post('register')
  @HttpCode(201)
  register(@Body() dto: RegisterParentDto, @Ip() ip: string) {
    return this.authService.registerParent(dto, ip ?? null);
  }

  @Post('logout')
  @MfaExempt()
  @HttpCode(200)
  logout(@CurrentUser() user: AuthenticatedUser, @Ip() ip: string) {
    return this.authService.logout(user.id, ip ?? null);
  }

  @Get('me')
  @MfaExempt()
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getProfile(user.id);
  }

  // ---------- MFA (Fase 4.2) — ADMIN & ADMIN_SUPER, boleh diakses saat pending ----------

  @Roles('ADMIN', 'ADMIN_SUPER')
  @MfaExempt()
  @Get('mfa/status')
  mfaStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.mfaStatus(user.id, user.role);
  }

  @Roles('ADMIN', 'ADMIN_SUPER')
  @MfaExempt()
  @Post('mfa/setup')
  @HttpCode(200)
  mfaSetup(@CurrentUser() user: AuthenticatedUser, @Ip() ip: string) {
    return this.authService.beginMfaSetup(user.id, ip ?? null);
  }

  @Roles('ADMIN', 'ADMIN_SUPER')
  @MfaExempt()
  @RateLimit({ limit: 10, windowSeconds: 300, scope: 'auth:mfa-enable' })
  @Post('mfa/enable')
  @HttpCode(200)
  mfaEnable(
    @Body() dto: MfaCodeDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.authService.enableMfa(user.id, dto.code, ip ?? null);
  }

  @Roles('ADMIN', 'ADMIN_SUPER')
  @RateLimit({ limit: 10, windowSeconds: 300, scope: 'auth:mfa-disable' })
  @Post('mfa/disable')
  @HttpCode(200)
  mfaDisable(
    @Body() dto: MfaCodeDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.authService.disableMfa(user.id, dto.code, ip ?? null);
  }

  @Roles('ADMIN', 'ADMIN_SUPER')
  @RateLimit({ limit: 10, windowSeconds: 300, scope: 'auth:mfa-recovery' })
  @Post('mfa/recovery-codes')
  @HttpCode(200)
  mfaRegenerateRecovery(
    @Body() dto: MfaCodeDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.authService.regenerateRecoveryCodes(user.id, dto.code, ip ?? null);
  }
}
