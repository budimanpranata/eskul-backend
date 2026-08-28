import { UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthService } from './auth.service.js';
import type { TokenService } from './token.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

vi.mock('argon2', () => ({
  verify: vi.fn(),
  hash: vi.fn(),
  argon2id: 2,
}));
import * as argon2 from 'argon2';

const mockedVerify = vi.mocked(argon2.verify);

function buildUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'user-1',
    fullName: 'Budi Pembina',
    email: 'budi@eskul.test',
    phoneNumber: '0811',
    passwordHash: 'argon2-hash',
    isActive: true,
    mfaEnabled: false,
    lastLoginAt: null,
    role: { id: 2, code: 'PEMBINA', name: 'Guru Pembina/Pelatih' },
    ...overrides,
  };
}

describe('AuthService', () => {
  let prisma: {
    user: {
      findFirst: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      findUniqueOrThrow: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };
  let tokens: {
    issueTokens: ReturnType<typeof vi.fn>;
    verifyRefreshToken: ReturnType<typeof vi.fn>;
    isSessionActive: ReturnType<typeof vi.fn>;
    revokeSession: ReturnType<typeof vi.fn>;
    revokeAllSessions: ReturnType<typeof vi.fn>;
  };
  let audit: { log: ReturnType<typeof vi.fn> };
  let service: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = {
      user: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    tokens = {
      issueTokens: vi.fn().mockResolvedValue({
        accessToken: 'access.jwt',
        refreshToken: 'refresh.jwt',
        expiresInSeconds: 900,
      }),
      verifyRefreshToken: vi.fn(),
      isSessionActive: vi.fn(),
      revokeSession: vi.fn().mockResolvedValue(undefined),
      revokeAllSessions: vi.fn().mockResolvedValue(2),
    };
    audit = { log: vi.fn().mockResolvedValue(undefined) };

    service = new AuthService(
      prisma as unknown as PrismaService,
      tokens as unknown as TokenService,
      audit as unknown as AuditService,
    );
  });

  describe('login', () => {
    it('login sukses → mengembalikan token + profil, mencatat LOGIN_SUCCESS, update lastLoginAt', async () => {
      prisma.user.findFirst.mockResolvedValue(buildUser());
      mockedVerify.mockResolvedValue(true);

      const result = await service.login(
        { identifier: 'budi@eskul.test', password: 'correct-horse' },
        '10.0.0.5',
      );

      expect(result).toMatchObject({
        accessToken: 'access.jwt',
        refreshToken: 'refresh.jwt',
        tokenType: 'Bearer',
        expiresIn: 900,
        user: { id: 'user-1', fullName: 'Budi Pembina', role: 'PEMBINA' },
      });
      expect(tokens.issueTokens).toHaveBeenCalledWith('user-1', 'PEMBINA');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { lastLoginAt: expect.any(Date) },
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'LOGIN_SUCCESS', userId: 'user-1', ipAddress: '10.0.0.5' }),
      );
    });

    it('password salah → UnauthorizedException dengan pesan generik + LOGIN_FAILED(BAD_PASSWORD)', async () => {
      prisma.user.findFirst.mockResolvedValue(buildUser());
      mockedVerify.mockResolvedValue(false);

      await expect(
        service.login({ identifier: 'budi@eskul.test', password: 'wrong' }, null),
      ).rejects.toThrowError(
        new UnauthorizedException('Email/No. HP atau password salah.'),
      );

      expect(tokens.issueTokens).not.toHaveBeenCalled();
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'LOGIN_FAILED',
          userId: 'user-1',
          metadata: expect.objectContaining({ reason: 'BAD_PASSWORD' }),
        }),
      );
    });

    it('identifier tidak dikenal → pesan generik SAMA (tidak membocorkan email vs password) + LOGIN_FAILED(USER_NOT_FOUND)', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.login({ identifier: 'nobody@eskul.test', password: 'x' }, null),
      ).rejects.toThrowError(
        new UnauthorizedException('Email/No. HP atau password salah.'),
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'LOGIN_FAILED',
          userId: null,
          metadata: expect.objectContaining({ reason: 'USER_NOT_FOUND' }),
        }),
      );
    });

    it('akun nonaktif → pesan generik + LOGIN_FAILED(USER_INACTIVE)', async () => {
      prisma.user.findFirst.mockResolvedValue(buildUser({ isActive: false }));

      await expect(
        service.login({ identifier: 'budi@eskul.test', password: 'correct-horse' }, null),
      ).rejects.toThrowError(UnauthorizedException);
      expect(mockedVerify).not.toHaveBeenCalled();
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: expect.objectContaining({ reason: 'USER_INACTIVE' }) }),
      );
    });
  });

  describe('refresh', () => {
    it('token valid & sesi aktif → rotasi (cabut jti lama, terbitkan baru) + TOKEN_REFRESH', async () => {
      tokens.verifyRefreshToken.mockResolvedValue({ sub: 'user-1', jti: 'jti-old', type: 'refresh' });
      tokens.isSessionActive.mockResolvedValue(true);
      prisma.user.findUnique.mockResolvedValue(buildUser());

      const result = await service.refresh('refresh.jwt', '10.0.0.9');

      expect(tokens.revokeSession).toHaveBeenCalledWith('user-1', 'jti-old');
      expect(tokens.issueTokens).toHaveBeenCalledWith('user-1', 'PEMBINA');
      expect(result.accessToken).toBe('access.jwt');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'TOKEN_REFRESH', userId: 'user-1' }),
      );
    });

    it('refresh token yang sudah di-revoke → UnauthorizedException (401), tidak menerbitkan token', async () => {
      tokens.verifyRefreshToken.mockResolvedValue({ sub: 'user-1', jti: 'jti-x', type: 'refresh' });
      tokens.isSessionActive.mockResolvedValue(false);

      await expect(service.refresh('refresh.jwt', null)).rejects.toThrowError(
        new UnauthorizedException('Sesi tidak dikenal atau sudah dicabut.'),
      );
      expect(tokens.issueTokens).not.toHaveBeenCalled();
    });

    it('user dinonaktifkan setelah token terbit → 401 dan sesi dicabut', async () => {
      tokens.verifyRefreshToken.mockResolvedValue({ sub: 'user-1', jti: 'jti-1', type: 'refresh' });
      tokens.isSessionActive.mockResolvedValue(true);
      prisma.user.findUnique.mockResolvedValue(buildUser({ isActive: false }));

      await expect(service.refresh('refresh.jwt', null)).rejects.toThrowError(UnauthorizedException);
      expect(tokens.revokeSession).toHaveBeenCalledWith('user-1', 'jti-1');
      expect(tokens.issueTokens).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('mencabut semua sesi refresh + mencatat LOGOUT', async () => {
      const res = await service.logout('user-1', '127.0.0.1');
      expect(tokens.revokeAllSessions).toHaveBeenCalledWith('user-1');
      expect(res).toEqual({ revokedSessions: 2 });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'LOGOUT', userId: 'user-1' }),
      );
    });
  });

  describe('getProfile', () => {
    it('mengembalikan profil ringkas tanpa password_hash', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue(buildUser());
      const profile = await service.getProfile('user-1');
      expect(profile).toMatchObject({ id: 'user-1', role: 'PEMBINA', email: 'budi@eskul.test' });
      expect(profile).not.toHaveProperty('passwordHash');
    });
  });
});
