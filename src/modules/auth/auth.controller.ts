import { Controller } from '@nestjs/common';
import { AuthService } from './auth.service.js';

/**
 * Autentikasi & RBAC (login, refresh token, guard @Roles). Fase 1.1.
 * FASE 0: kerangka controller — route ditambahkan pada fase terkait.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}
}
