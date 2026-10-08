import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { JwtAuthGuard } from './jwt-auth.guard.js';

function ctx(headers: Record<string, string> = {}): { context: ExecutionContext; req: any } {
  const req: any = { headers };
  const context = {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
  return { context, req };
}

describe('JwtAuthGuard', () => {
  let jwt: { verifyAsync: ReturnType<typeof vi.fn> };
  let config: { get: ReturnType<typeof vi.fn> };
  let reflector: Reflector;
  let guard: JwtAuthGuard;

  beforeEach(() => {
    jwt = { verifyAsync: vi.fn() };
    config = { get: vi.fn().mockReturnValue('access-secret') };
    reflector = new Reflector();
    guard = new JwtAuthGuard(
      jwt as unknown as JwtService,
      config as unknown as ConfigService,
      reflector,
    );
  });

  it('route @Public() → lolos tanpa cek token', async () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const { context } = ctx();
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
  });

  it('token akses valid → menempelkan { id, role } ke request.user', async () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    jwt.verifyAsync.mockResolvedValue({ sub: 'user-9', role: 'ADMIN', type: 'access', sch: 'school-1' });
    const { context, req } = ctx({ authorization: 'Bearer good.token' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.user).toEqual({ id: 'user-9', role: 'ADMIN', mfaPending: false, schoolId: 'school-1' });
  });

  it('tanpa header Authorization → UnauthorizedException', async () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const { context } = ctx();
    await expect(guard.canActivate(context)).rejects.toThrowError(UnauthorizedException);
  });

  it('token bertipe refresh dipakai sebagai akses → UnauthorizedException', async () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    jwt.verifyAsync.mockResolvedValue({ sub: 'user-9', jti: 'j1', type: 'refresh' });
    const { context } = ctx({ authorization: 'Bearer refresh.token' });
    await expect(guard.canActivate(context)).rejects.toThrowError(UnauthorizedException);
  });

  it('verifikasi JWT gagal (signature/expired) → UnauthorizedException', async () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    jwt.verifyAsync.mockRejectedValue(new Error('jwt expired'));
    const { context } = ctx({ authorization: 'Bearer bad.token' });
    await expect(guard.canActivate(context)).rejects.toThrowError(UnauthorizedException);
  });
});
