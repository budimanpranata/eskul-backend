import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';

import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { type RoleCode } from '../../common/types/authenticated-user.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RegisterParentDto } from './dto/register-parent.dto.js';
import { MfaService } from './mfa.service.js';
import { TokenService } from './token.service.js';

/** Pesan generik — tidak membocorkan apakah identifier atau password yang salah. */
const GENERIC_LOGIN_ERROR = 'Email/No. HP atau password salah.';

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: { id: string; fullName: string; role: RoleCode };
  /** true → admin ini wajib menyelesaikan setup MFA sebelum mengakses fitur lain. */
  mfaSetupRequired?: boolean;
}

/** Respons langkah-1 login ketika akun sudah mengaktifkan MFA. */
export interface MfaChallengeResult {
  mfaRequired: true;
  mfaToken: string;
  expiresIn: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly mfa: MfaService,
  ) {}

  async login(dto: LoginDto, ip: string | null): Promise<AuthResult | MfaChallengeResult> {
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ email: dto.identifier }, { phoneNumber: dto.identifier }] },
      include: { role: true },
    });

    if (!user) {
      await this.audit.log({
        userId: null,
        action: 'LOGIN_FAILED',
        entityType: 'user',
        ipAddress: ip,
        metadata: { identifier: dto.identifier, reason: 'USER_NOT_FOUND' },
      });
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    if (!user.isActive) {
      await this.audit.log({
        userId: user.id,
        action: 'LOGIN_FAILED',
        entityType: 'user',
        entityId: user.id,
        ipAddress: ip,
        metadata: { identifier: dto.identifier, reason: 'USER_INACTIVE' },
      });
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    const passwordValid = await argon2.verify(user.passwordHash, dto.password).catch(() => false);
    if (!passwordValid) {
      await this.audit.log({
        userId: user.id,
        action: 'LOGIN_FAILED',
        entityType: 'user',
        entityId: user.id,
        ipAddress: ip,
        metadata: { identifier: dto.identifier, reason: 'BAD_PASSWORD' },
      });
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    const role = user.role.code as RoleCode;

    // Langkah 2FA: bila akun sudah mengaktifkan MFA → belum terbitkan sesi,
    // kembalikan token tantangan yang harus ditukar dengan kode TOTP.
    if (user.mfaEnabled) {
      const challenge = await this.tokens.issueMfaChallenge(user.id);
      await this.audit.log({
        userId: user.id,
        action: 'LOGIN_MFA_CHALLENGE',
        entityType: 'user',
        entityId: user.id,
        ipAddress: ip,
        metadata: { role },
      });
      return { mfaRequired: true, mfaToken: challenge.token, expiresIn: challenge.expiresInSeconds };
    }

    // Admin tanpa MFA + enforcement menyala → sesi "pending" (akses dibatasi).
    const mfaPending = this.mfa.mfaPendingFor(role, user.mfaEnabled);
    const issued = await this.tokens.issueTokens(user.id, role, { mfaPending });

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await this.audit.log({
      userId: user.id,
      action: 'LOGIN_SUCCESS',
      entityType: 'user',
      entityId: user.id,
      ipAddress: ip,
      metadata: { role, mfaPending },
    });

    return {
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      tokenType: 'Bearer',
      expiresIn: issued.expiresInSeconds,
      user: { id: user.id, fullName: user.fullName, role },
      // Hanya "wajib" bila enforcement menyala (mfaPending sudah mencakup
      // isEnforced && admin && !mfaEnabled). Bila MFA_ENFORCE_ADMIN=false,
      // admin tetap bisa mengaktifkan MFA manual lewat halaman Keamanan.
      ...(mfaPending ? { mfaSetupRequired: true } : {}),
    };
  }

  /** Langkah-2 login: tukar token tantangan + kode TOTP/recovery → sesi penuh. */
  async completeMfaLogin(
    mfaToken: string,
    code: string,
    ip: string | null,
  ): Promise<AuthResult> {
    const userId = await this.tokens.verifyMfaChallenge(mfaToken);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });
    if (!user || !user.isActive) throw new UnauthorizedException(GENERIC_LOGIN_ERROR);

    let method: 'totp' | 'recovery';
    try {
      ({ method } = await this.mfa.verify(user.id, code));
    } catch (err) {
      await this.audit.log({
        userId: user.id,
        action: 'LOGIN_MFA_FAILED',
        entityType: 'user',
        entityId: user.id,
        ipAddress: ip,
      });
      throw err;
    }

    const role = user.role.code as RoleCode;
    const issued = await this.tokens.issueTokens(user.id, role); // MFA lolos → sesi penuh
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.log({
      userId: user.id,
      action: 'LOGIN_MFA_SUCCESS',
      entityType: 'user',
      entityId: user.id,
      ipAddress: ip,
      metadata: { role, method },
    });

    return {
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      tokenType: 'Bearer',
      expiresIn: issued.expiresInSeconds,
      user: { id: user.id, fullName: user.fullName, role },
    };
  }

  async refresh(refreshToken: string, ip: string | null): Promise<AuthResult> {
    const payload = await this.tokens.verifyRefreshToken(refreshToken);

    const active = await this.tokens.isSessionActive(payload.sub, payload.jti);
    if (!active) {
      throw new UnauthorizedException('Sesi tidak dikenal atau sudah dicabut.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { role: true },
    });
    if (!user || !user.isActive) {
      // Sesi menggantung untuk user yang sudah dinonaktifkan → cabut.
      await this.tokens.revokeSession(payload.sub, payload.jti);
      throw new UnauthorizedException('Sesi tidak dikenal atau sudah dicabut.');
    }

    // Rotasi: cabut sesi lama, terbitkan yang baru.
    await this.tokens.revokeSession(payload.sub, payload.jti);
    const role = user.role.code as RoleCode;
    // Hitung ulang status pending: sekali MFA aktif, refresh berikutnya lepas flag.
    const mfaPending = this.mfa.mfaPendingFor(role, user.mfaEnabled);
    const issued = await this.tokens.issueTokens(user.id, role, { mfaPending });

    await this.audit.log({
      userId: user.id,
      action: 'TOKEN_REFRESH',
      entityType: 'user',
      entityId: user.id,
      ipAddress: ip,
    });

    return {
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      tokenType: 'Bearer',
      expiresIn: issued.expiresInSeconds,
      user: { id: user.id, fullName: user.fullName, role },
      ...(mfaPending ? { mfaSetupRequired: true } : {}),
    };
  }

  // ---------- MFA management (Fase 4.2) ----------

  async beginMfaSetup(userId: string, ip: string | null) {
    const res = await this.mfa.beginSetup(userId);
    await this.audit.log({
      userId,
      action: 'MFA_SETUP_STARTED',
      entityType: 'user',
      entityId: userId,
      ipAddress: ip,
    });
    return res;
  }

  /** Aktifkan MFA + terbitkan sesi PENUH baru (admin pending langsung lepas batas). */
  async enableMfa(
    userId: string,
    code: string,
    ip: string | null,
  ): Promise<AuthResult & { recoveryCodes: string[] }> {
    const { recoveryCodes } = await this.mfa.enable(userId, code);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { role: true },
    });
    const role = user.role.code as RoleCode;
    // Cabut sesi lama (yang mungkin ber-flag pending) lalu terbitkan yang bersih.
    await this.tokens.revokeAllSessions(userId);
    const issued = await this.tokens.issueTokens(userId, role);
    await this.audit.log({
      userId,
      action: 'MFA_ENABLED',
      entityType: 'user',
      entityId: userId,
      ipAddress: ip,
      metadata: { role },
    });
    return {
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      tokenType: 'Bearer',
      expiresIn: issued.expiresInSeconds,
      user: { id: user.id, fullName: user.fullName, role },
      recoveryCodes,
    };
  }

  async disableMfa(userId: string, code: string, ip: string | null): Promise<{ disabled: true }> {
    await this.mfa.disable(userId, code);
    await this.tokens.revokeAllSessions(userId); // paksa login ulang (kembali via jalur normal)
    await this.audit.log({
      userId,
      action: 'MFA_DISABLED',
      entityType: 'user',
      entityId: userId,
      ipAddress: ip,
    });
    return { disabled: true };
  }

  async regenerateRecoveryCodes(userId: string, code: string, ip: string | null) {
    const res = await this.mfa.regenerateRecoveryCodes(userId, code);
    await this.audit.log({
      userId,
      action: 'MFA_RECOVERY_REGENERATED',
      entityType: 'user',
      entityId: userId,
      ipAddress: ip,
    });
    return res;
  }

  mfaStatus(userId: string, role: RoleCode) {
    return this.mfa.status(userId, role);
  }

  async logout(userId: string, ip: string | null): Promise<{ revokedSessions: number }> {
    const revoked = await this.tokens.revokeAllSessions(userId);
    await this.audit.log({
      userId,
      action: 'LOGOUT',
      entityType: 'user',
      entityId: userId,
      ipAddress: ip,
      metadata: { revokedSessions: revoked },
    });
    return { revokedSessions: revoked };
  }

  /** Pendaftaran mandiri akun Orang Tua + login langsung. */
  async registerParent(dto: RegisterParentDto, ip: string | null): Promise<AuthResult> {
    const clash = await this.prisma.user.findFirst({
      where: { OR: [{ email: dto.email }, ...(dto.phoneNumber ? [{ phoneNumber: dto.phoneNumber }] : [])] },
      select: { id: true },
    });
    if (clash) throw new ConflictException('Email atau nomor HP sudah terdaftar.');

    const orangtuaRole = await this.prisma.role.findUniqueOrThrow({ where: { code: 'ORANGTUA' } });
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });

    const user = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          roleId: orangtuaRole.id,
          fullName: dto.fullName,
          email: dto.email,
          phoneNumber: dto.phoneNumber ?? null,
          passwordHash,
        },
      });
      await tx.parent.create({ data: { userId: u.id, relationType: dto.relationType } });
      return u;
    });

    // Consent dicatat eksplisit dengan timestamp (dokumen desain bagian 7.2).
    await this.audit.log({
      userId: user.id,
      action: 'PARENT_CONSENT_GIVEN',
      entityType: 'user',
      entityId: user.id,
      ipAddress: ip,
      metadata: { relationType: dto.relationType, consentAt: new Date().toISOString() },
    });
    await this.audit.log({
      userId: user.id,
      action: 'REGISTER_PARENT',
      entityType: 'user',
      entityId: user.id,
      ipAddress: ip,
    });

    const issued = await this.tokens.issueTokens(user.id, 'ORANGTUA');
    return {
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      tokenType: 'Bearer',
      expiresIn: issued.expiresInSeconds,
      user: { id: user.id, fullName: user.fullName, role: 'ORANGTUA' },
    };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { role: true },
    });
    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      phoneNumber: user.phoneNumber,
      role: user.role.code as RoleCode,
      isActive: user.isActive,
      mfaEnabled: user.mfaEnabled,
      lastLoginAt: user.lastLoginAt,
    };
  }
}
