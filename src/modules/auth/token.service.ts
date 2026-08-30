import { randomUUID } from 'node:crypto';

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { RedisService } from '../../redis/redis.service.js';
import type {
  AccessTokenPayload,
  MfaChallengeTokenPayload,
  RefreshTokenPayload,
  RoleCode,
} from '../../common/types/authenticated-user.js';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  /** umur access token dalam detik (untuk field `expires_in` di response). */
  expiresInSeconds: number;
}

/**
 * Penerbitan & verifikasi JWT + manajemen sesi refresh token di Redis.
 *
 * Model revocation = allow-list: sebuah refresh token hanya sah bila `jti`-nya
 * masih terdaftar di Redis. Logout / reset password menghapus entri → token
 * lama otomatis tidak berlaku (dokumen desain bagian 7.1).
 *
 * Orkestrasi login/refresh ada di AuthService; kelas ini murni token + Redis.
 */
@Injectable()
export class TokenService {
  static readonly ACCESS_TTL_SECONDS = 15 * 60; // 15 menit (dokumen desain 7.1)

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {}

  /** Terbitkan pasangan access + refresh token baru, daftarkan sesi refresh ke Redis. */
  async issueTokens(
    userId: string,
    role: RoleCode,
    opts: { mfaPending?: boolean } = {},
  ): Promise<IssuedTokens> {
    const jti = randomUUID();

    const accessPayload: AccessTokenPayload = { sub: userId, role, type: 'access' };
    if (opts.mfaPending) accessPayload.mfaPending = true;

    const accessToken = await this.jwt.signAsync(accessPayload, {
      secret: this.config.get<string>('jwt.accessSecret'),
      expiresIn: TokenService.ACCESS_TTL_SECONDS,
    });

    const refreshTtlSeconds = this.refreshTtlSeconds();
    const refreshToken = await this.jwt.signAsync(
      { sub: userId, jti, type: 'refresh' } satisfies RefreshTokenPayload,
      {
        secret: this.config.get<string>('jwt.refreshSecret'),
        expiresIn: refreshTtlSeconds,
      },
    );

    await this.redis.client.set(this.sessionKey(jti), userId, 'EX', refreshTtlSeconds);
    await this.redis.client.sadd(this.indexKey(userId), jti);
    await this.redis.client.expire(this.indexKey(userId), refreshTtlSeconds);

    return { accessToken, refreshToken, expiresInSeconds: TokenService.ACCESS_TTL_SECONDS };
  }

  // ---------- MFA challenge (Fase 4.2) ----------

  /** Token sesaat yang membuktikan langkah password lolos; ditukar dengan kode TOTP. */
  async issueMfaChallenge(userId: string): Promise<{ token: string; expiresInSeconds: number }> {
    const expiresInSeconds = this.config.get<number>('mfa.challengeTtlSeconds') ?? 300;
    const token = await this.jwt.signAsync(
      { sub: userId, type: 'mfa_challenge' } satisfies MfaChallengeTokenPayload,
      { secret: this.config.get<string>('jwt.accessSecret'), expiresIn: expiresInSeconds },
    );
    return { token, expiresInSeconds };
  }

  async verifyMfaChallenge(token: string): Promise<string> {
    let payload: MfaChallengeTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<MfaChallengeTokenPayload>(token, {
        secret: this.config.get<string>('jwt.accessSecret'),
      });
    } catch {
      throw new UnauthorizedException('Sesi verifikasi MFA tidak valid atau kedaluwarsa.');
    }
    if (payload.type !== 'mfa_challenge') {
      throw new UnauthorizedException('Jenis token tidak sesuai.');
    }
    return payload.sub;
  }

  /** Verifikasi tanda tangan + tipe refresh token. Tidak menyentuh Redis. */
  async verifyRefreshToken(refreshToken: string): Promise<RefreshTokenPayload> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(refreshToken, {
        secret: this.config.get<string>('jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Refresh token tidak valid atau kedaluwarsa.');
    }
    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Jenis token tidak sesuai.');
    }
    return payload;
  }

  /** True bila sesi `jti` masih aktif untuk `userId` di Redis (belum dicabut). */
  async isSessionActive(userId: string, jti: string): Promise<boolean> {
    const owner = await this.redis.client.get(this.sessionKey(jti));
    return owner === userId;
  }

  async revokeSession(userId: string, jti: string): Promise<void> {
    await this.redis.client.del(this.sessionKey(jti));
    await this.redis.client.srem(this.indexKey(userId), jti);
  }

  /** Cabut SEMUA sesi refresh milik user (logout / reset password). Return jumlah sesi dicabut. */
  async revokeAllSessions(userId: string): Promise<number> {
    const indexKey = this.indexKey(userId);
    const jtis = await this.redis.client.smembers(indexKey);
    if (jtis.length > 0) {
      await this.redis.client.del(...jtis.map((jti) => this.sessionKey(jti)));
    }
    await this.redis.client.del(indexKey);
    return jtis.length;
  }

  /**
   * TTL refresh token (detik), diambil dari `JWT_REFRESH_TTL`.
   * Menerima format `30d` / `12h` / `45m` / `3600s` / angka detik. Default 30 hari.
   */
  private refreshTtlSeconds(): number {
    const raw = (this.config.get<string>('jwt.refreshTtl') ?? '30d').trim();
    const match = /^(\d+)\s*([smhd]?)$/i.exec(raw);
    if (!match) return 30 * 24 * 60 * 60;
    const value = Number(match[1]);
    const unit = match[2].toLowerCase();
    const factor = unit === 'd' ? 86400 : unit === 'h' ? 3600 : unit === 'm' ? 60 : 1;
    return value * factor;
  }

  private sessionKey(jti: string): string {
    return `auth:rt:${jti}`;
  }

  private indexKey(userId: string): string {
    return `auth:rt:index:${userId}`;
  }
}
