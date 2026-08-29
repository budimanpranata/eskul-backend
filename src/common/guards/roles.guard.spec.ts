import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RolesGuard } from './roles.guard.js';
import type { RoleCode } from '../types/authenticated-user.js';

function contextWithUser(role?: RoleCode): ExecutionContext {
  const req = role ? { user: { id: 'u1', role } } : {};
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let reflector: Reflector;
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('route tanpa @Roles() → izinkan role apa pun', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(contextWithUser('ORANGTUA'))).toBe(true);
  });

  it('role cocok → izinkan', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN', 'PEMBINA']);
    expect(guard.canActivate(contextWithUser('PEMBINA'))).toBe(true);
  });

  it('lintas-role (ORANGTUA menuju endpoint ADMIN) → ForbiddenException (403)', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
    expect(() => guard.canActivate(contextWithUser('ORANGTUA'))).toThrowError(ForbiddenException);
  });

  it('tanpa user di request (mis. guard auth dilewati) → 403', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
    expect(() => guard.canActivate(contextWithUser())).toThrowError(ForbiddenException);
  });

  it('ADMIN_SUPER memenuhi @Roles("ADMIN") (hierarki role)', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
    expect(guard.canActivate(contextWithUser('ADMIN_SUPER'))).toBe(true);
  });

  it('ADMIN biasa TIDAK bisa mengakses endpoint @Roles("ADMIN_SUPER") → 403', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN_SUPER']);
    expect(() => guard.canActivate(contextWithUser('ADMIN'))).toThrowError(ForbiddenException);
  });
});
