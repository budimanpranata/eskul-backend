import { CanActivate, type ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { MFA_EXEMPT_KEY } from '../decorators/mfa-exempt.decorator.js';
import type { AuthenticatedUser } from '../types/authenticated-user.js';

/**
 * Guard global (setelah JwtAuthGuard & RolesGuard): sesi admin yang belum
 * mengaktifkan MFA (`mfaPending`) hanya boleh mengakses route ber-`@MfaExempt()`.
 * (Kebijakan Fase 4.2 — admin baru wajib setup MFA lebih dulu.)
 */
@Injectable()
export class MfaGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    if (!request.user?.mfaPending) return true;

    const exempt = this.reflector.getAllAndOverride<boolean>(MFA_EXEMPT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (exempt) return true;

    throw new ForbiddenException({
      error: 'MFA_SETUP_REQUIRED',
      message: 'Aktifkan MFA terlebih dahulu untuk mengakses fitur ini.',
    });
  }
}
