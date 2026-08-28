import { CanActivate, type ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ROLES_KEY } from '../decorators/roles.decorator.js';
import type { AuthenticatedUser, RoleCode } from '../types/authenticated-user.js';

/**
 * Guard global: berjalan setelah JwtAuthGuard. Bila route punya @Roles(...),
 * pastikan role user termasuk yang diizinkan; jika tidak → 403.
 *
 * Route tanpa @Roles() cukup terautentikasi (role apa pun boleh).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<RoleCode[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;

    if (!user || !requiredRoles.includes(user.role)) {
      throw new ForbiddenException('Anda tidak memiliki hak akses untuk sumber daya ini.');
    }
    return true;
  }
}
