import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TokenService } from './token.service.js';
import type { RedisService } from '../../redis/redis.service.js';

describe('TokenService', () => {
  let jwt: { signAsync: ReturnType<typeof vi.fn>; verifyAsync: ReturnType<typeof vi.fn> };
  let redisClient: Record<string, ReturnType<typeof vi.fn>>;
  let config: { get: ReturnType<typeof vi.fn> };
  let service: TokenService;

  beforeEach(() => {
    jwt = {
      signAsync: vi.fn(async (payload: Record<string, unknown>) =>
        payload.type === 'access' ? 'ACCESS' : 'REFRESH',
      ),
      verifyAsync: vi.fn(),
    };
    redisClient = {
      set: vi.fn().mockResolvedValue('OK'),
      get: vi.fn(),
      sadd: vi.fn().mockResolvedValue(1),
      srem: vi.fn().mockResolvedValue(1),
      del: vi.fn().mockResolvedValue(1),
      smembers: vi.fn().mockResolvedValue([]),
      expire: vi.fn().mockResolvedValue(1),
    };
    config = {
      get: vi.fn((key: string) => {
        const map: Record<string, string> = {
          'jwt.accessSecret': 'access-secret',
          'jwt.refreshSecret': 'refresh-secret',
          'jwt.refreshTtl': '30d',
        };
        return map[key];
      }),
    };

    service = new TokenService(
      jwt as unknown as JwtService,
      config as unknown as ConfigService,
      { client: redisClient } as unknown as RedisService,
    );
  });

  describe('issueTokens', () => {
    it('mengembalikan access+refresh, expiresIn 900 detik, dan mendaftarkan sesi ke Redis', async () => {
      const result = await service.issueTokens('user-1', 'ADMIN');

      expect(result).toEqual({
        accessToken: 'ACCESS',
        refreshToken: 'REFRESH',
        expiresInSeconds: 900,
      });
      // sesi refresh disimpan dengan TTL 30 hari (2.592.000 detik)
      expect(redisClient.set).toHaveBeenCalledWith(
        expect.stringMatching(/^auth:rt:/),
        'user-1',
        'EX',
        30 * 24 * 60 * 60,
      );
      expect(redisClient.sadd).toHaveBeenCalledWith(
        expect.stringMatching(/^auth:rt:index:user-1$/),
        expect.any(String),
      );
    });

    it('menghormati JWT_REFRESH_TTL berformat jam (mis. "12h")', async () => {
      config.get.mockImplementation((k: string) =>
        k === 'jwt.refreshTtl' ? '12h' : 'secret',
      );
      await service.issueTokens('user-2', 'PEMBINA');
      expect(redisClient.set).toHaveBeenCalledWith(
        expect.any(String),
        'user-2',
        'EX',
        12 * 3600,
      );
    });
  });

  describe('verifyRefreshToken', () => {
    it('menolak token yang bukan bertipe refresh', async () => {
      jwt.verifyAsync.mockResolvedValue({ sub: 'u', role: 'ADMIN', type: 'access' });
      await expect(service.verifyRefreshToken('t')).rejects.toThrowError(UnauthorizedException);
    });

    it('menolak token dengan signature invalid', async () => {
      jwt.verifyAsync.mockRejectedValue(new Error('invalid signature'));
      await expect(service.verifyRefreshToken('t')).rejects.toThrowError(UnauthorizedException);
    });

    it('menerima token refresh yang sah', async () => {
      jwt.verifyAsync.mockResolvedValue({ sub: 'u', jti: 'j', type: 'refresh' });
      await expect(service.verifyRefreshToken('t')).resolves.toEqual({
        sub: 'u',
        jti: 'j',
        type: 'refresh',
      });
    });
  });

  describe('revocation', () => {
    it('isSessionActive true hanya bila Redis mengembalikan userId yang cocok', async () => {
      redisClient.get.mockResolvedValueOnce('user-1');
      expect(await service.isSessionActive('user-1', 'jti-1')).toBe(true);
      redisClient.get.mockResolvedValueOnce(null);
      expect(await service.isSessionActive('user-1', 'jti-1')).toBe(false);
    });

    it('revokeAllSessions menghapus setiap sesi + index, mengembalikan jumlahnya', async () => {
      redisClient.smembers.mockResolvedValue(['a', 'b', 'c']);
      const count = await service.revokeAllSessions('user-1');
      expect(count).toBe(3);
      expect(redisClient.del).toHaveBeenCalledWith('auth:rt:a', 'auth:rt:b', 'auth:rt:c');
      expect(redisClient.del).toHaveBeenCalledWith('auth:rt:index:user-1');
    });

    it('revokeAllSessions tanpa sesi aktif hanya menghapus index', async () => {
      redisClient.smembers.mockResolvedValue([]);
      const count = await service.revokeAllSessions('user-1');
      expect(count).toBe(0);
      expect(redisClient.del).toHaveBeenCalledTimes(1);
      expect(redisClient.del).toHaveBeenCalledWith('auth:rt:index:user-1');
    });

    it('revokeSession menghapus satu sesi + entri index', async () => {
      await service.revokeSession('user-1', 'jti-9');
      expect(redisClient.del).toHaveBeenCalledWith('auth:rt:jti-9');
      expect(redisClient.srem).toHaveBeenCalledWith('auth:rt:index:user-1', 'jti-9');
    });
  });

  describe('parsing JWT_REFRESH_TTL', () => {
    it.each([
      ['3600s', 3600],
      ['600', 600],
      ['bogus', 30 * 24 * 60 * 60],
    ])('format "%s" → %i detik TTL Redis', async (ttl, expected) => {
      config.get.mockImplementation((k: string) => (k === 'jwt.refreshTtl' ? ttl : 'secret'));
      await service.issueTokens('user-x', 'ADMIN');
      expect(redisClient.set).toHaveBeenLastCalledWith(
        expect.any(String),
        'user-x',
        'EX',
        expected,
      );
    });
  });
});
