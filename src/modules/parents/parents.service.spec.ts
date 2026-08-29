import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ParentsService, shiftDays } from './parents.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

describe('shiftDays', () => {
  it('menggeser tanggal (UTC) maju/mundur', () => {
    expect(shiftDays('2026-08-29', -90)).toBe('2026-05-31');
    expect(shiftDays('2026-08-29', 1)).toBe('2026-08-30');
    expect(shiftDays('2026-01-01', -1)).toBe('2025-12-31');
  });
});

describe('ParentsService', () => {
  let prisma: any;
  let audit: { log: ReturnType<typeof vi.fn> };
  let service: ParentsService;

  beforeEach(() => {
    prisma = {
      parent: { findUnique: vi.fn().mockResolvedValue({ id: 'p1' }) },
      parentStudentRelation: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn(),
        update: vi.fn(),
      },
      student: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
      extracurricularMember: { findMany: vi.fn().mockResolvedValue([]) },
      attendanceDetail: { findMany: vi.fn().mockResolvedValue([]) },
      notification: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    audit = { log: vi.fn().mockResolvedValue(undefined) };
    const notifications = { enqueueUserNotification: vi.fn().mockResolvedValue(undefined) };
    service = new ParentsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      notifications as never,
    );
  });

  describe('childProgress', () => {
    it('tanpa relasi APPROVED → 403 UNAUTHORIZED_RELATION', async () => {
      prisma.parentStudentRelation.findFirst.mockResolvedValue(null);
      try {
        await service.childProgress('s1', { period: 'weekly' } as any, { userId: 'u1', ip: null });
        throw new Error('harus throw');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ForbiddenException);
        expect(e.getResponse()).toMatchObject({ error: 'UNAUTHORIZED_RELATION' });
      }
      expect(prisma.student.findUniqueOrThrow).not.toHaveBeenCalled();
    });

    it('relasi APPROVED → payload snake_case + audit VIEW_STUDENT_DATA', async () => {
      prisma.parentStudentRelation.findFirst.mockResolvedValue({ id: 'r1' });
      prisma.student.findUniqueOrThrow.mockResolvedValue({
        id: 's1',
        fullName: 'Ananda',
        classGrade: '3A',
        photoUrl: null,
      });
      const res = await service.childProgress(
        's1',
        { period: 'weekly' } as any,
        { userId: 'u1', ip: '1.2.3.4' },
      );
      expect(res.student).toEqual({
        id: 's1',
        full_name: 'Ananda',
        class_grade: '3A',
        photo_url: null,
      });
      expect(res.extracurriculars).toEqual([]);
      expect(res.latest_notification).toBeNull();
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'VIEW_STUDENT_DATA', entityId: 's1' }),
      );
    });
  });

  describe('linkRequest', () => {
    it('NIS tidak ada → 404', async () => {
      prisma.student.findUnique.mockResolvedValue(null);
      await expect(
        service.linkRequest({ nis: 'X', studentName: 'a' } as any, { userId: 'u1', ip: null }),
      ).rejects.toThrowError(/tidak ditemukan/);
    });

    it('nama tidak cocok dengan NIS → 400', async () => {
      prisma.student.findUnique.mockResolvedValue({ id: 's1', fullName: 'Budi Santoso', isActive: true });
      await expect(
        service.linkRequest(
          { nis: 'N1', studentName: 'Andi Wijaya' } as any,
          { userId: 'u1', ip: null },
        ),
      ).rejects.toThrowError(/tidak cocok/);
    });

    it('sukses → PENDING + audit PARENT_LINK_REQUEST', async () => {
      prisma.student.findUnique.mockResolvedValue({ id: 's1', fullName: 'Budi Santoso', isActive: true });
      prisma.parentStudentRelation.findUnique.mockResolvedValue(null);
      prisma.parentStudentRelation.create.mockResolvedValue({ id: 'rel-1' });
      const res = await service.linkRequest(
        { nis: 'N1', studentName: 'budi' } as any,
        { userId: 'u1', ip: null },
      );
      expect(res).toMatchObject({ id: 'rel-1', status: 'PENDING' });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PARENT_LINK_REQUEST', entityId: 'rel-1' }),
      );
    });

    it('REJECTED < 24 jam lalu → 409 dengan jeda; > 24 jam → boleh ajukan ulang', async () => {
      prisma.student.findUnique.mockResolvedValue({ id: 's1', fullName: 'Budi Santoso', isActive: true });

      // ditolak 2 jam lalu
      prisma.parentStudentRelation.findUnique.mockResolvedValue({
        id: 'rel-1',
        approvalStatus: 'REJECTED',
        approvedAt: new Date(Date.now() - 2 * 3600_000),
      });
      await expect(
        service.linkRequest({ nis: 'N1', studentName: 'budi' } as any, { userId: 'u1', ip: null }),
      ).rejects.toThrowError(/jam/);
      expect(prisma.parentStudentRelation.update).not.toHaveBeenCalled();

      // ditolak 30 jam lalu → boleh
      prisma.parentStudentRelation.findUnique.mockResolvedValue({
        id: 'rel-1',
        approvalStatus: 'REJECTED',
        approvedAt: new Date(Date.now() - 30 * 3600_000),
      });
      prisma.parentStudentRelation.update.mockResolvedValue({});
      const res = await service.linkRequest(
        { nis: 'N1', studentName: 'budi' } as any,
        { userId: 'u1', ip: null },
      );
      expect(res.status).toBe('PENDING');
    });
  });

  describe('listRelations — badge SUSPICIOUS', () => {
    it('nomor HP dgn > 5 siswa berbeda / 24 jam → suspicious=true', async () => {
      prisma.$transaction = vi.fn().mockResolvedValue([
        1,
        [
          {
            id: 'r1',
            approvalStatus: 'PENDING',
            createdAt: new Date(),
            approvedAt: null,
            parent: { relationType: 'IBU', user: { fullName: 'A', email: null, phoneNumber: '0811' } },
            student: { id: 's1', nis: 'N', fullName: 'X', classGrade: '4A' },
          },
        ],
      ]);
      // 6 siswa berbeda untuk nomor 0811 dalam 24 jam
      prisma.parentStudentRelation.findMany.mockResolvedValue(
        Array.from({ length: 6 }, (_, i) => ({ studentId: `s${i}` })),
      );

      const res = await service.listRelations('PENDING', 1, 20);
      expect((res.data as any[])[0].suspicious).toBe(true);
    });

    it('nomor HP dgn <= 5 siswa → suspicious=false', async () => {
      prisma.$transaction = vi.fn().mockResolvedValue([
        1,
        [
          {
            id: 'r1',
            approvalStatus: 'PENDING',
            createdAt: new Date(),
            approvedAt: null,
            parent: { relationType: 'IBU', user: { fullName: 'A', email: null, phoneNumber: '0899' } },
            student: { id: 's1', nis: 'N', fullName: 'X', classGrade: '4A' },
          },
        ],
      ]);
      prisma.parentStudentRelation.findMany.mockResolvedValue([{ studentId: 's1' }, { studentId: 's2' }]);

      const res = await service.listRelations('PENDING', 1, 20);
      expect((res.data as any[])[0].suspicious).toBe(false);
    });
  });
});
