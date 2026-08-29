import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuditService } from './audit.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { AuditQueryDto } from './dto/audit-query.dto.js';

describe('AuditService', () => {
  let prisma: {
    auditLog: { create: ReturnType<typeof vi.fn> };
    $queryRaw: ReturnType<typeof vi.fn>;
  };
  let svc: AuditService;

  beforeEach(() => {
    prisma = {
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      $queryRaw: vi.fn(),
    };
    svc = new AuditService(prisma as unknown as PrismaService);
  });

  describe('log', () => {
    it('menulis baris audit_logs', async () => {
      await svc.log({ action: 'VIEW_STUDENT_DATA', entityType: 'student', userId: 'u1', entityId: 's1' });
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'VIEW_STUDENT_DATA', userId: 'u1', entityId: 's1' }),
        }),
      );
    });

    it('kegagalan tulis TIDAK melempar (audit tak boleh menggagalkan request)', async () => {
      prisma.auditLog.create.mockRejectedValue(new Error('db down'));
      await expect(svc.log({ action: 'X', entityType: 'y' })).resolves.toBeUndefined();
    });
  });

  describe('query', () => {
    const run = (f: Partial<AuditQueryDto>) =>
      svc.query({ page: 1, pageSize: 20, ...f } as AuditQueryDto);

    it('mengembalikan data + meta pagination; menjalankan query rows & count', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: '1', action: 'A' }, { id: '2', action: 'B' }])
        .mockResolvedValueOnce([{ total: 42 }]);

      const res = await run({});
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
      expect(res.data).toHaveLength(2);
      expect(res.meta).toMatchObject({ page: 1, pageSize: 20, total: 42, totalPages: 3 });
    });

    it('total 0 → totalPages minimal 1, data kosong', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0 }]);
      const res = await run({ action: 'NON_EXISTENT' });
      expect(res.data).toEqual([]);
      expect(res.meta).toMatchObject({ total: 0, totalPages: 1 });
    });

    it('menerima seluruh filter tanpa error (userId/action/entityType/entityId/tanggal/q)', async () => {
      prisma.$queryRaw.mockResolvedValue([]).mockResolvedValue([{ total: 0 }]);
      prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0 }]);
      await expect(
        run({
          userId: '11111111-1111-1111-1111-111111111111',
          action: 'EXPORT_REPORT',
          entityType: 'report_export',
          entityId: '22222222-2222-2222-2222-222222222222',
          dateFrom: '2026-08-01',
          dateTo: '2026-08-31',
          q: 'kelas 4A',
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('facets', () => {
    it('mengembalikan daftar action & entityType unik', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ action: 'EXPORT_REPORT' }, { action: 'VIEW_STUDENT_DATA' }])
        .mockResolvedValueOnce([{ entity_type: 'report' }, { entity_type: 'student' }]);
      const res = await svc.facets();
      expect(res).toEqual({
        actions: ['EXPORT_REPORT', 'VIEW_STUDENT_DATA'],
        entityTypes: ['report', 'student'],
      });
    });
  });
});
