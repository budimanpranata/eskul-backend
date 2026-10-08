import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthController } from './auth.controller.js';
import type { AuthService } from './auth.service.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';

describe('AuthController', () => {
  let authService: {
    login: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
    logout: ReturnType<typeof vi.fn>;
    getProfile: ReturnType<typeof vi.fn>;
  };
  let controller: AuthController;

  beforeEach(() => {
    authService = {
      login: vi.fn().mockResolvedValue({ accessToken: 'a' }),
      refresh: vi.fn().mockResolvedValue({ accessToken: 'b' }),
      logout: vi.fn().mockResolvedValue({ revokedSessions: 1 }),
      getProfile: vi.fn().mockResolvedValue({ id: 'u1' }),
    };
    controller = new AuthController(authService as unknown as AuthService);
  });

  it('POST /auth/login meneruskan dto + ip ke service', async () => {
    await controller.login({ identifier: 'a@b.c', password: 'x' }, '1.2.3.4');
    expect(authService.login).toHaveBeenCalledWith({ identifier: 'a@b.c', password: 'x' }, '1.2.3.4');
  });

  it('POST /auth/refresh meneruskan hanya refreshToken (bukan seluruh dto)', async () => {
    await controller.refresh({ refreshToken: 'r.t' }, '1.2.3.4');
    expect(authService.refresh).toHaveBeenCalledWith('r.t', '1.2.3.4');
  });

  it('ip null diteruskan bila @Ip() kosong', async () => {
    await controller.login({ identifier: 'a', password: 'b' }, undefined as unknown as string);
    expect(authService.login).toHaveBeenCalledWith(expect.anything(), null);
  });

  it('POST /auth/logout memakai id dari CurrentUser', async () => {
    const user: AuthenticatedUser = { id: 'u1', role: 'ADMIN', schoolId: 'school-1' };
    await controller.logout(user, '1.2.3.4');
    expect(authService.logout).toHaveBeenCalledWith('u1', '1.2.3.4');
  });

  it('GET /auth/me mengambil profil user login', async () => {
    await controller.me({ id: 'u1', role: 'PEMBINA', schoolId: 'school-1' });
    expect(authService.getProfile).toHaveBeenCalledWith('u1');
  });
});
