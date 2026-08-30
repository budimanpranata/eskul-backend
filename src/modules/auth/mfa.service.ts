import { randomBytes } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';

import { PrismaService } from '../../prisma/prisma.service.js';
import { isAdminRole, type RoleCode } from '../../common/types/authenticated-user.js';

const TOTP_STEP_SECONDS = 30;
const RECOVERY_CODE_COUNT = 10;
/** Karakter tanpa yang ambigu (0/O, 1/I). */
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// window 1 = terima kode step ±1 untuk toleransi selisih jam (standar).
authenticator.options = { step: TOTP_STEP_SECONDS, window: 1 };

export type MfaVerifyMethod = 'totp' | 'recovery';

function genRecoveryCode(): string {
  const pick = () =>
    Array.from(randomBytes(5))
      .map((b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length])
      .join('');
  return `${pick()}-${pick()}`;
}

/** Normalisasi input kode pemulihan (buang spasi/strip, huruf besar). */
function normalizeRecovery(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  isEnforced(): boolean {
    return this.config.get<boolean>('mfa.enforceAdmin') ?? true;
  }

  /** Apakah sesi user ini "pending" (admin, MFA belum aktif, dan enforcement menyala). */
  mfaPendingFor(role: RoleCode, mfaEnabled: boolean): boolean {
    return this.isEnforced() && isAdminRole(role) && !mfaEnabled;
  }

  /** Langkah 1 setup: buat secret provisional + otpauth URI untuk QR. */
  async beginSetup(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, phoneNumber: true, mfaEnabled: true },
    });
    if (user.mfaEnabled) {
      throw new ConflictException('MFA sudah aktif. Nonaktifkan dulu untuk mengganti perangkat.');
    }

    const secret = authenticator.generateSecret();
    await this.prisma.user.update({ where: { id: userId }, data: { mfaSecret: secret } });

    const issuer = this.config.get<string>('mfa.issuer') ?? 'Eskul SD';
    const account = user.email ?? user.phoneNumber ?? userId;
    return {
      secret,
      otpauthUrl: authenticator.keyuri(account, issuer, secret),
      issuer,
      account,
    };
  }

  /** Langkah 2 setup: verifikasi kode dari authenticator → aktifkan + terbitkan recovery codes. */
  async enable(userId: string, code: string): Promise<{ recoveryCodes: string[] }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { mfaEnabled: true, mfaSecret: true },
    });
    if (user.mfaEnabled) throw new ConflictException('MFA sudah aktif.');
    if (!user.mfaSecret) throw new BadRequestException('Mulai setup MFA terlebih dahulu.');

    const counter = this.checkTotp(user.mfaSecret, code, null);
    if (counter == null) throw new UnauthorizedException('Kode MFA tidak valid.');

    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, genRecoveryCode);
    const hashes = await Promise.all(codes.map((c) => argon2.hash(normalizeRecovery(c), { type: argon2.argon2id })));

    await this.prisma.$transaction([
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.user.update({
        where: { id: userId },
        data: { mfaEnabled: true, mfaEnabledAt: new Date(), mfaLastCounter: BigInt(counter) },
      }),
      this.prisma.mfaRecoveryCode.createMany({
        data: hashes.map((codeHash) => ({ userId, codeHash })),
      }),
    ]);

    return { recoveryCodes: codes };
  }

  /**
   * Verifikasi kode MFA (TOTP atau recovery). Melempar `UnauthorizedException` bila salah.
   * Untuk TOTP: menerapkan anti-replay via `mfa_last_counter`.
   */
  async verify(userId: string, code: string): Promise<{ method: MfaVerifyMethod }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { mfaEnabled: true, mfaSecret: true, mfaLastCounter: true },
    });
    if (!user.mfaEnabled || !user.mfaSecret) {
      throw new UnauthorizedException('MFA belum aktif untuk akun ini.');
    }

    const trimmed = code.trim();
    // Kode TOTP = 6 digit; selain itu diperlakukan sebagai recovery code.
    if (/^\d{6}$/.test(trimmed)) {
      const last = user.mfaLastCounter == null ? null : Number(user.mfaLastCounter);
      const counter = this.checkTotp(user.mfaSecret, trimmed, last);
      if (counter == null) throw new UnauthorizedException('Kode MFA tidak valid atau sudah dipakai.');
      await this.prisma.user.update({
        where: { id: userId },
        data: { mfaLastCounter: BigInt(counter) },
      });
      return { method: 'totp' };
    }

    // Recovery code: cocokkan ke salah satu hash yang belum terpakai, lalu tandai used.
    const candidates = await this.prisma.mfaRecoveryCode.findMany({
      where: { userId, usedAt: null },
      select: { id: true, codeHash: true },
    });
    const norm = normalizeRecovery(trimmed);
    for (const c of candidates) {
      if (await argon2.verify(c.codeHash, norm).catch(() => false)) {
        const res = await this.prisma.mfaRecoveryCode.updateMany({
          where: { id: c.id, usedAt: null }, // guard race: hanya bila masih belum dipakai
          data: { usedAt: new Date() },
        });
        if (res.count === 1) return { method: 'recovery' };
      }
    }
    throw new UnauthorizedException('Kode MFA tidak valid atau sudah dipakai.');
  }

  async disable(userId: string, code: string): Promise<void> {
    await this.verify(userId, code);
    await this.prisma.$transaction([
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.user.update({
        where: { id: userId },
        data: { mfaEnabled: false, mfaSecret: null, mfaEnabledAt: null, mfaLastCounter: null },
      }),
    ]);
  }

  async regenerateRecoveryCodes(userId: string, code: string): Promise<{ recoveryCodes: string[] }> {
    await this.verify(userId, code);
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, genRecoveryCode);
    const hashes = await Promise.all(
      codes.map((c) => argon2.hash(normalizeRecovery(c), { type: argon2.argon2id })),
    );
    await this.prisma.$transaction([
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.mfaRecoveryCode.createMany({
        data: hashes.map((codeHash) => ({ userId, codeHash })),
      }),
    ]);
    return { recoveryCodes: codes };
  }

  async status(userId: string, role: RoleCode) {
    const [user, remaining] = await this.prisma.$transaction([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { mfaEnabled: true, mfaEnabledAt: true },
      }),
      this.prisma.mfaRecoveryCode.count({ where: { userId, usedAt: null } }),
    ]);
    return {
      enabled: user.mfaEnabled,
      enabledAt: user.mfaEnabledAt,
      pending: this.mfaPendingFor(role, user.mfaEnabled),
      enforced: this.isEnforced(),
      recoveryCodesRemaining: user.mfaEnabled ? remaining : 0,
    };
  }

  /**
   * Verifikasi TOTP dengan window ±1. Mengembalikan nomor step yang cocok, atau
   * `null` bila tidak valid / step-nya <= `lastCounter` (anti-replay).
   */
  private checkTotp(secret: string, token: string, lastCounter: number | null): number | null {
    if (!/^\d{6}$/.test(token.trim())) return null;
    const delta = authenticator.checkDelta(token.trim(), secret); // -1 | 0 | 1 | null
    if (delta == null) return null;
    const counter = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS) + delta;
    if (lastCounter != null && counter <= lastCounter) return null;
    return counter;
  }
}
