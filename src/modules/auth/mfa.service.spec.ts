import { ConflictException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { authenticator } from 'otplib';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MfaService } from './mfa.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

// Hash argon2 di-stub agar unit test cepat & deterministik (bukan menguji argon2).
vi.mock('argon2', () => ({
  argon2id: 2,
  hash: vi.fn(async (s: string) => `h:${s}`),
  verify: vi.fn(async (hash: string, s: string) => hash === `h:${s}`),
}));

const cfg = (over: Record<string, unknown> = {}): ConfigService =>
  ({
    get: (k: string) =>
      ({ 'mfa.enforceAdmin': true, 'mfa.issuer': 'Eskul Test', ...over })[k],
  }) as unknown as ConfigService;

function mkPrisma() {
  const state: {
    user: Record<string, unknown>;
    recovery: { id: string; codeHash: string; usedAt: Date | null }[];
  } = { user: {}, recovery: [] };
  const prisma = {
    _state: state,
    user: {
      findUniqueOrThrow: vi.fn(async () => state.user),
      update: vi.fn(async ({ data }: any) => {
        Object.assign(state.user, data);
        return state.user;
      }),
    },
    mfaRecoveryCode: {
      deleteMany: vi.fn(async () => {
        state.recovery = [];
        return { count: 0 };
      }),
      createMany: vi.fn(async ({ data }: any) => {
        state.recovery.push(
          ...data.map((d: any, i: number) => ({ id: `rc${i}`, codeHash: d.codeHash, usedAt: null })),
        );
        return { count: data.length };
      }),
      findMany: vi.fn(async () => state.recovery.filter((r) => r.usedAt == null)),
      updateMany: vi.fn(async ({ where }: any) => {
        const row = state.recovery.find((r) => r.id === where.id && r.usedAt == null);
        if (!row) return { count: 0 };
        row.usedAt = new Date();
        return { count: 1 };
      }),
      count: vi.fn(async () => state.recovery.filter((r) => r.usedAt == null).length),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return prisma as unknown as PrismaService & { _state: typeof state };
}

describe('MfaService', () => {
  let prisma: ReturnType<typeof mkPrisma>;
  let svc: MfaService;

  beforeEach(() => {
    prisma = mkPrisma();
    svc = new MfaService(prisma, cfg());
  });

  describe('mfaPendingFor', () => {
    it('admin tanpa MFA + enforcement → pending; non-admin / MFA aktif → tidak', () => {
      expect(svc.mfaPendingFor('ADMIN', false)).toBe(true);
      expect(svc.mfaPendingFor('ADMIN_SUPER', false)).toBe(true);
      expect(svc.mfaPendingFor('ADMIN', true)).toBe(false);
      expect(svc.mfaPendingFor('PEMBINA', false)).toBe(false);
    });
    it('enforcement mati → tidak pernah pending', () => {
      const s = new MfaService(prisma, cfg({ 'mfa.enforceAdmin': false }));
      expect(s.mfaPendingFor('ADMIN', false)).toBe(false);
    });
  });

  describe('beginSetup', () => {
    it('menyimpan secret provisional + kembalikan otpauth URI', async () => {
      prisma._state.user = { email: 'a@b.test', phoneNumber: null, mfaEnabled: false };
      const res = await svc.beginSetup('u1');
      expect(res.secret).toHaveLength(16);
      expect(res.otpauthUrl).toMatch(/^otpauth:\/\/totp\/.*Eskul%20Test/);
      expect(prisma._state.user.mfaSecret).toBe(res.secret);
    });
    it('MFA sudah aktif → ConflictException', async () => {
      prisma._state.user = { email: 'a@b.test', mfaEnabled: true };
      await expect(svc.beginSetup('u1')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('enable', () => {
    it('kode salah → UnauthorizedException, MFA tetap nonaktif', async () => {
      prisma._state.user = { mfaEnabled: false, mfaSecret: authenticator.generateSecret() };
      await expect(svc.enable('u1', '000000')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma._state.user.mfaEnabled).not.toBe(true);
    });

    it('kode benar → aktif + 10 recovery code + counter tersimpan', async () => {
      const secret = authenticator.generateSecret();
      prisma._state.user = { mfaEnabled: false, mfaSecret: secret };
      const { recoveryCodes } = await svc.enable('u1', authenticator.generate(secret));
      expect(recoveryCodes).toHaveLength(10);
      expect(recoveryCodes.every((c) => /^[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(c))).toBe(true);
      expect(prisma._state.user.mfaEnabled).toBe(true);
      expect(prisma._state.user.mfaLastCounter).toEqual(expect.any(BigInt));
      expect(prisma._state.recovery).toHaveLength(10);
    });
  });

  describe('verify (TOTP anti-replay + window)', () => {
    let secret: string;
    beforeEach(async () => {
      secret = authenticator.generateSecret();
      prisma._state.user = { mfaEnabled: false, mfaSecret: secret };
      await svc.enable('u1', authenticator.generate(secret));
      // enable menyimpan counter step saat ini
    });

    it('kode TOTP valid → { method: "totp" } dan mencatat counter', async () => {
      // majukan waktu 30s agar counter > counter saat enable (hindari replay-block)
      const spy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 30_000);
      const token = authenticator.generate(secret);
      const res = await svc.verify('u1', token);
      expect(res).toEqual({ method: 'totp' });
      spy.mockRestore();
    });

    it('memakai kode TOTP yang sama dua kali (replay) → ditolak di percobaan kedua', async () => {
      const spy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000);
      const token = authenticator.generate(secret);
      await svc.verify('u1', token); // ok
      await expect(svc.verify('u1', token)).rejects.toBeInstanceOf(UnauthorizedException);
      spy.mockRestore();
    });

    it('kode 6-digit ngawur → UnauthorizedException', async () => {
      await expect(svc.verify('u1', '123456')).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('verify (recovery code sekali pakai)', () => {
    it('recovery code valid sekali; percobaan kedua ditolak', async () => {
      const secret = authenticator.generateSecret();
      prisma._state.user = { mfaEnabled: false, mfaSecret: secret };
      const { recoveryCodes } = await svc.enable('u1', authenticator.generate(secret));
      const code = recoveryCodes[0];

      const first = await svc.verify('u1', code);
      expect(first).toEqual({ method: 'recovery' });
      // baris ditandai used
      expect(prisma._state.recovery[0].usedAt).toBeInstanceOf(Date);
      await expect(svc.verify('u1', code)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('recovery code dengan/ tanpa strip & huruf kecil → tetap cocok', async () => {
      const secret = authenticator.generateSecret();
      prisma._state.user = { mfaEnabled: false, mfaSecret: secret };
      const { recoveryCodes } = await svc.enable('u1', authenticator.generate(secret));
      const messy = recoveryCodes[1].replace('-', '').toLowerCase();
      await expect(svc.verify('u1', messy)).resolves.toEqual({ method: 'recovery' });
    });
  });

  describe('disable', () => {
    it('butuh kode valid; setelah itu MFA & recovery codes dihapus', async () => {
      const secret = authenticator.generateSecret();
      prisma._state.user = { mfaEnabled: false, mfaSecret: secret };
      const { recoveryCodes } = await svc.enable('u1', authenticator.generate(secret));

      await svc.disable('u1', recoveryCodes[2]);
      expect(prisma._state.user.mfaEnabled).toBe(false);
      expect(prisma._state.user.mfaSecret).toBeNull();
      expect(prisma._state.recovery).toHaveLength(0);
    });
  });

  describe('status', () => {
    it('mengembalikan enabled / pending / sisa recovery code', async () => {
      const secret = authenticator.generateSecret();
      prisma._state.user = { mfaEnabled: false, mfaSecret: secret };
      await svc.enable('u1', authenticator.generate(secret));
      prisma._state.user.mfaEnabledAt = new Date();

      const st = await svc.status('u1', 'ADMIN');
      expect(st).toMatchObject({ enabled: true, pending: false, enforced: true, recoveryCodesRemaining: 10 });
    });
  });
});
