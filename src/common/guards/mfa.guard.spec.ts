import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MfaGuard } from './mfa.guard.js';

function ctx(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('MfaGuard', () => {
  let reflector: Reflector;
  let guard: MfaGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new MfaGuard(reflector);
  });

  it('sesi tanpa mfaPending → lolos', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(ctx({ id: 'u', role: 'ADMIN' }))).toBe(true);
  });

  it('mfaPending + route TIDAK @MfaExempt → 403 MFA_SETUP_REQUIRED', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    try {
      guard.canActivate(ctx({ id: 'u', role: 'ADMIN', mfaPending: true }));
      throw new Error('harus throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenException);
      expect((e as ForbiddenException).getResponse()).toMatchObject({ error: 'MFA_SETUP_REQUIRED' });
    }
  });

  it('mfaPending + route @MfaExempt → lolos', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    expect(guard.canActivate(ctx({ id: 'u', role: 'ADMIN', mfaPending: true }))).toBe(true);
  });

  it('tanpa user (route publik) → lolos', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(ctx(undefined))).toBe(true);
  });
});
