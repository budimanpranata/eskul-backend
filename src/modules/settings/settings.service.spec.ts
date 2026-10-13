import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsService } from './settings.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

describe('SettingsService', () => {
  let prisma: any;
  let audit: { log: ReturnType<typeof vi.fn> };
  let storage: { put: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
  let service: SettingsService;

  const actor = { id: 'super-1', ip: null };

  beforeEach(() => {
    prisma = { appSettings: { findUnique: vi.fn(), upsert: vi.fn() } };
    audit = { log: vi.fn().mockResolvedValue(undefined) };
    storage = {
      put: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(Buffer.from('img')),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const config = { get: vi.fn().mockReturnValue(undefined) };
    service = new SettingsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      config as any,
      storage as any,
    );
  });

  describe('getBranding', () => {
    it('belum ada baris sama sekali → default Eskul + logoUrl null', async () => {
      prisma.appSettings.findUnique.mockResolvedValue(null);
      const res = await service.getBranding();
      expect(res).toEqual({ appName: 'Eskul', logoUrl: null });
    });

    it('appName kosong/whitespace di DB → tetap fallback default', async () => {
      prisma.appSettings.findUnique.mockResolvedValue({ appName: '   ', logoKey: null, updatedAt: new Date() });
      const res = await service.getBranding();
      expect(res.appName).toBe('Eskul');
    });

    it('sudah diatur → appName custom + logoUrl ber-cache-bust', async () => {
      const updatedAt = new Date('2026-10-14T00:00:00Z');
      prisma.appSettings.findUnique.mockResolvedValue({
        appName: 'SD Harapan Bangsa',
        logoKey: 'branding/logo-1.png',
        updatedAt,
      });
      const res = await service.getBranding();
      expect(res.appName).toBe('SD Harapan Bangsa');
      expect(res.logoUrl).toBe(`/api/v1/settings/branding/logo?v=${updatedAt.getTime()}`);
    });
  });

  describe('updateBranding', () => {
    it('format logo tidak didukung → 400, tidak upsert', async () => {
      prisma.appSettings.findUnique.mockResolvedValue(null);
      const file = { fieldname: 'logo', originalname: 'x.pdf', mimetype: 'application/pdf', size: 100, buffer: Buffer.from('x') };
      await expect(service.updateBranding({}, file, actor)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.appSettings.upsert).not.toHaveBeenCalled();
    });

    it('logo terlalu besar → 400', async () => {
      prisma.appSettings.findUnique.mockResolvedValue(null);
      const file = { fieldname: 'logo', originalname: 'x.png', mimetype: 'image/png', size: 5 * 1024 * 1024, buffer: Buffer.from('x') };
      await expect(service.updateBranding({}, file, actor)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('appName kosong string → direset ke null (pakai default)', async () => {
      prisma.appSettings.findUnique.mockResolvedValue({ appName: 'Lama', logoKey: null, updatedAt: new Date() });
      prisma.appSettings.upsert.mockResolvedValue({ appName: null, logoKey: null, updatedAt: new Date() });
      const res = await service.updateBranding({ appName: '' }, undefined, actor);
      expect(prisma.appSettings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: expect.objectContaining({ appName: null }) }),
      );
      expect(res.appName).toBe('Eskul');
    });

    it('upload logo baru → simpan ke storage, hapus logo lama, audit log', async () => {
      const oldDate = new Date('2026-01-01T00:00:00Z');
      prisma.appSettings.findUnique.mockResolvedValue({ appName: 'X', logoKey: 'branding/old.png', updatedAt: oldDate });
      const newDate = new Date('2026-10-14T00:00:00Z');
      prisma.appSettings.upsert.mockResolvedValue({ appName: 'X', logoKey: expect.any(String), updatedAt: newDate });
      const file = { fieldname: 'logo', originalname: 'new.png', mimetype: 'image/png', size: 1000, buffer: Buffer.from('x') };

      await service.updateBranding({}, file, actor);

      expect(storage.put).toHaveBeenCalledWith(expect.stringMatching(/^branding\/logo-\d+\.png$/), file.buffer, 'image/png');
      expect(storage.remove).toHaveBeenCalledWith('branding/old.png');
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'UPDATE_APP_SETTINGS' }));
    });

    it('tanpa file → tidak menyentuh storage sama sekali', async () => {
      prisma.appSettings.findUnique.mockResolvedValue(null);
      prisma.appSettings.upsert.mockResolvedValue({ appName: 'X', logoKey: null, updatedAt: new Date() });
      await service.updateBranding({ appName: 'X' }, undefined, actor);
      expect(storage.put).not.toHaveBeenCalled();
      expect(storage.remove).not.toHaveBeenCalled();
    });
  });

  describe('getLogoBuffer', () => {
    it('belum ada logo → 404', async () => {
      prisma.appSettings.findUnique.mockResolvedValue(null);
      await expect(service.getLogoBuffer()).rejects.toBeInstanceOf(NotFoundException);
    });

    it('ada logo → ambil buffer + content-type dari ekstensi', async () => {
      prisma.appSettings.findUnique.mockResolvedValue({ logoKey: 'branding/logo-1.webp' });
      const res = await service.getLogoBuffer();
      expect(res.contentType).toBe('image/webp');
      expect(storage.get).toHaveBeenCalledWith('branding/logo-1.webp');
    });
  });
});
