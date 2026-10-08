import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ParentsService, bucketActivenessTrend, shiftDays } from './parents.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

describe('shiftDays', () => {
  it('menggeser tanggal (UTC) maju/mundur', () => {
    expect(shiftDays('2026-08-29', -90)).toBe('2026-05-31');
    expect(shiftDays('2026-08-29', 1)).toBe('2026-08-30');
    expect(shiftDays('2026-01-01', -1)).toBe('2025-12-31');
  });
});

describe('bucketActivenessTrend', () => {
  const row = (date: string, status: string, score: number | null) => ({
    sessionDate: new Date(`${date}T00:00:00.000Z`),
    status,
    score,
  });

  it('weekly: rata-rata skor per minggu (Senin), terurut kronologis', () => {
    const out = bucketActivenessTrend(
      [
        row('2026-08-04', 'HADIR', 5), // Sel, minggu Senin 2026-08-03
        row('2026-08-06', 'HADIR', 3), // Kam, minggu sama
        row('2026-08-11', 'HADIR', 4), // minggu Senin 2026-08-10
      ],
      'weekly',
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ bucket: '2026-08-03', avg_score: 4, sessions: 2 });
    expect(out[1]).toMatchObject({ bucket: '2026-08-10', avg_score: 4, sessions: 1 });
  });

  it('monthly: rata-rata skor per bulan', () => {
    const out = bucketActivenessTrend(
      [row('2026-07-20', 'HADIR', 2), row('2026-08-02', 'HADIR', 4), row('2026-08-30', 'HADIR', 2)],
      'monthly',
    );
    expect(out).toEqual([
      { bucket: '2026-07', label: 'Jul 2026', avg_score: 2, sessions: 1 },
      { bucket: '2026-08', label: 'Agu 2026', avg_score: 3, sessions: 2 },
    ]);
  });

  it('abaikan baris non-HADIR dan skor null', () => {
    const out = bucketActivenessTrend(
      [
        row('2026-08-04', 'IZIN', null),
        row('2026-08-04', 'HADIR', null),
        row('2026-08-05', 'ALPA', null),
        row('2026-08-06', 'HADIR', 5),
      ],
      'weekly',
    );
    expect(out).toEqual([{ bucket: '2026-08-03', label: '3 Agu', avg_score: 5, sessions: 1 }]);
  });

  it('data minim (1 titik) tetap menghasilkan 1 entri, tidak error', () => {
    expect(bucketActivenessTrend([row('2026-08-06', 'HADIR', 4)], 'weekly')).toHaveLength(1);
    expect(bucketActivenessTrend([], 'monthly')).toEqual([]);
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
      school: { findUnique: vi.fn().mockResolvedValue({ id: 'school-1', isActive: true }) },
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

    it('per-ekskul: average_activeness + evaluations (skor & catatan per sesi)', async () => {
      prisma.parentStudentRelation.findFirst.mockResolvedValue({ id: 'r1' });
      prisma.student.findUniqueOrThrow.mockResolvedValue({
        id: 's1', fullName: 'Ananda', classGrade: '3A', photoUrl: null,
      });
      prisma.extracurricularMember.findMany.mockResolvedValue([
        { extracurricularId: 'e1', extracurricular: { id: 'e1', name: 'Futsal' } },
      ]);
      const sess = (date: string) => ({
        extracurricularId: 'e1',
        sessionDate: new Date(`${date}T00:00:00.000Z`),
        materialDescription: null, // tanpa deskripsi materi — evaluations tetap muncul
        coach: { user: { fullName: 'Pak Andi' } },
      });
      prisma.attendanceDetail.findMany.mockResolvedValue([
        { status: 'HADIR', activenessScore: 4, skillNotes: 'Passing membaik', personalNotes: null, session: sess('2026-08-04') },
        { status: 'HADIR', activenessScore: 5, skillNotes: null, personalNotes: 'Sangat percaya diri', session: sess('2026-08-11') },
        { status: 'IZIN', activenessScore: null, skillNotes: null, personalNotes: null, session: sess('2026-08-18') },
      ]);

      const res = await service.childProgress(
        's1', { period: 'weekly' } as any, { userId: 'u1', ip: null },
      );
      const ek = res.extracurriculars[0] as any;
      expect(ek.average_activeness).toBe(4.5);
      expect(ek.evaluations).toHaveLength(2); // baris IZIN tanpa skor/catatan tidak masuk
      expect(ek.evaluations[0]).toMatchObject({
        activeness_score: 5, personal_notes: 'Sangat percaya diri', coach_name: 'Pak Andi',
      });
      expect(ek.evaluations[1]).toMatchObject({ activeness_score: 4, skill_notes: 'Passing membaik' });
    });
  });

  describe('linkRequest', () => {
    it('NIS tidak ada → 404', async () => {
      prisma.student.findUnique.mockResolvedValue(null);
      await expect(
        service.linkRequest({ schoolCode: 'SD-DEFAULT', nis: 'X', studentName: 'a' } as any, { userId: 'u1', ip: null }),
      ).rejects.toThrowError(/tidak ditemukan/);
    });

    it('nama tidak cocok dengan NIS → 400', async () => {
      prisma.student.findUnique.mockResolvedValue({ id: 's1', fullName: 'Budi Santoso', isActive: true });
      await expect(
        service.linkRequest(
          { schoolCode: 'SD-DEFAULT', nis: 'N1', studentName: 'Andi Wijaya' } as any,
          { userId: 'u1', ip: null },
        ),
      ).rejects.toThrowError(/tidak cocok/);
    });

    it('sukses → PENDING + audit PARENT_LINK_REQUEST', async () => {
      prisma.student.findUnique.mockResolvedValue({ id: 's1', fullName: 'Budi Santoso', isActive: true });
      prisma.parentStudentRelation.findUnique.mockResolvedValue(null);
      prisma.parentStudentRelation.create.mockResolvedValue({ id: 'rel-1' });
      const res = await service.linkRequest(
        { schoolCode: 'SD-DEFAULT', nis: 'N1', studentName: 'budi' } as any,
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
        service.linkRequest({ schoolCode: 'SD-DEFAULT', nis: 'N1', studentName: 'budi' } as any, { userId: 'u1', ip: null }),
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
        { schoolCode: 'SD-DEFAULT', nis: 'N1', studentName: 'budi' } as any,
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

      const res = await service.listRelations('PENDING', 1, 20, undefined);
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

      const res = await service.listRelations('PENDING', 1, 20, undefined);
      expect((res.data as any[])[0].suspicious).toBe(false);
    });
  });
});
