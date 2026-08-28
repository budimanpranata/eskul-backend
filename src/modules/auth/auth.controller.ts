import { Body, Controller, Get, HttpCode, Ip, Post } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshDto } from './dto/refresh.dto.js';

/**
 * Autentikasi — dokumen desain bagian 4.3.
 *  POST /auth/login    (publik)  email/no HP + password  -> access + refresh token
 *  POST /auth/refresh  (publik)  refresh token           -> pasangan token baru (rotasi)
 *  POST /auth/logout   (auth)    cabut seluruh sesi refresh user
 *  GET  /auth/me       (auth)    profil user yang login
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Ip() ip: string) {
    return this.authService.login(dto, ip ?? null);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto, @Ip() ip: string) {
    return this.authService.refresh(dto.refreshToken, ip ?? null);
  }

  @Post('logout')
  @HttpCode(200)
  logout(@CurrentUser() user: AuthenticatedUser, @Ip() ip: string) {
    return this.authService.logout(user.id, ip ?? null);
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getProfile(user.id);
  }
}
