import { ConflictException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AttendanceService, isoDayOfWeek, summarize } from './attendance.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

describe('summarize', () => {
  it('menghitung per status + total', () => {
    expect(summarize(['HADIR', 'HADIR', 'IZIN', 'SAKIT', 'ALPA', 'HADIR'])).toEqual({
      total_students: 6,
      hadir: 3,
      izin: 1,
      sakit: 1,
      alpa: 1,
    });
  });
  it('daftar kosong', () => {
    expect(summarize([])).toEqual({ total_students: 0, hadir: 0, izin: 0, sakit: 0, alpa: 0 });
  });
});

describe('isoDayOfWeek', () => {
  it('Senin=1 .. Minggu=7', () => {
    expect(isoDayOfWeek('2026-08-31')).toBe(1); // Senin
    expect(isoDayOfWeek('2026-08-29')).toBe(6); // Sabtu
    expect(isoDayOfWeek('2026-08-30')).toBe(7); // Minggu
  });
});

describe('AttendanceService.submit', () => {
  let prisma: any;
  let audit: { log: ReturnType<typeof vi.fn> };
  let service: AttendanceService;

  const baseDto = {
    client_generated_id: '11111111-1111-4111-8111-111111111111',
    extracurricular_id: '22222222-2222-4222-8222-222222222222',
    session_date: isoToday(),
    attendances: [{ student_id: '33333333-3333-4333-8333-333333333333', status: 'HADIR' as const }],
  };

  beforeEach(() => {
    prisma = {
      coach: { findUnique: vi.fn().mockResolvedValue({ id: 'coach-1' }) },
      attendanceSession: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      extracurricular: {
        findUnique: vi.fn().mockResolvedValue({ id: baseDto.extracurricular_id, isActive: true, defaultCoachId: 'coach-1' }),
      },
      extracurricularSchedule: { findFirst: vi.fn().mockResolvedValue({ id: 's1' }) },
      extracurricularMember: {
        findMany: vi.fn().mockResolvedValue([
          { studentId: baseDto.attendances[0].student_id, student: { isActive: true } },
        ]),
        findUnique: vi.fn().mockResolvedValue({ id: 'member-1' }),
      },
      student: { findUnique: vi.fn() },
      $transaction: vi.fn().mockResolvedValue('new-session-id'),
    };
    audit = { log: vi.fn().mockResolvedValue(undefined) };
    const notifications = { enqueueAttendanceDone: vi.fn().mockResolvedValue(undefined) };
    service = new AttendanceService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      notifications as never,
    );
  });

  it('sukses → 201-style payload + audit SUBMIT_ATTENDANCE', async () => {
    const res = await service.submit(baseDto as any, { userId: 'u1', ip: null });
    expect(res).toMatchObject({ session_id: 'new-session-id', status: 'SUBMITTED' });
    expect(res.summary).toEqual({ total_students: 1, hadir: 1, izin: 0, sakit: 0, alpa: 0 });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SUBMIT_ATTENDANCE', entityId: 'new-session-id' }),
    );
  });

  it('replay client_generated_id → 409 SESSION_ALREADY_SYNCED', async () => {
    prisma.attendanceSession.findUnique.mockResolvedValue({ id: 'existing-1' });
    await expect(service.submit(baseDto as any, { userId: 'u1', ip: null })).rejects.toMatchObject({
      constructor: ConflictException,
    });
    try {
      await service.submit(baseDto as any, { userId: 'u1', ip: null });
    } catch (e: any) {
      expect(e.getResponse()).toEqual({
        error: 'SESSION_ALREADY_SYNCED',
        message: expect.any(String),
        existing_session_id: 'existing-1',
      });
    }
  });

  it('sesi (ekskul,tanggal,coach) sudah ada → 409', async () => {
    prisma.attendanceSession.findFirst.mockResolvedValue({ id: 'dup-1' });
    await expect(service.submit(baseDto as any, { userId: 'u1', ip: null })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('bukan pembina ekskul → 403', async () => {
    prisma.extracurricular.findUnique.mockResolvedValue({ id: baseDto.extracurricular_id, isActive: true, defaultCoachId: 'coach-lain' });
    await expect(service.submit(baseDto as any, { userId: 'u1', ip: null })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('siswa bukan anggota → 422 dengan details field attendances[0].student_id', async () => {
    prisma.extracurricularMember.findMany.mockResolvedValue([]); // tidak ada member cocok
    try {
      await service.submit(baseDto as any, { userId: 'u1', ip: null });
      throw new Error('seharusnya throw');
    } catch (e: any) {
      expect(e).toBeInstanceOf(UnprocessableEntityException);
      expect(e.getResponse().details).toEqual([
        { field: 'attendances[0].student_id', message: expect.stringContaining('bukan anggota') },
      ]);
    }
  });

  it('tanggal masa depan → 422 field session_date', async () => {
    const dto = { ...baseDto, session_date: '2099-01-01' };
    try {
      await service.submit(dto as any, { userId: 'u1', ip: null });
      throw new Error('seharusnya throw');
    } catch (e: any) {
      expect(e).toBeInstanceOf(UnprocessableEntityException);
      expect(e.getResponse().details[0].field).toBe('session_date');
    }
  });

  it('activeness_score untuk siswa non-HADIR → 422 field attendances[i].activeness_score', async () => {
    const dto = {
      ...baseDto,
      attendances: [{ student_id: baseDto.attendances[0].student_id, status: 'IZIN', activeness_score: 4 }],
    };
    try {
      await service.submit(dto as any, { userId: 'u1', ip: null });
      throw new Error('seharusnya throw');
    } catch (e: any) {
      expect(e).toBeInstanceOf(UnprocessableEntityException);
      expect(e.getResponse().details).toEqual([
        {
          field: 'attendances[0].activeness_score',
          message: expect.stringContaining('HADIR'),
        },
      ]);
    }
  });

  describe('resolveQrScan', () => {
    const EK = baseDto.extracurricular_id;

    it('token tidak dikenal → 404 QR_INVALID', async () => {
      prisma.student.findUnique.mockResolvedValue(null);
      try {
        await service.resolveQrScan('u1', 'token-x', EK, null);
        throw new Error('harus throw');
      } catch (e: any) {
        expect(e.getResponse()).toMatchObject({ error: 'QR_INVALID' });
      }
    });

    it('siswa bukan anggota ekskul → 422 NOT_A_MEMBER', async () => {
      prisma.student.findUnique.mockResolvedValue({
        id: 'stu-1', nis: 'N', fullName: 'A', classGrade: '5A', photoUrl: null, isActive: true,
      });
      prisma.extracurricularMember.findUnique.mockResolvedValue(null);
      try {
        await service.resolveQrScan('u1', 'tok', EK, null);
        throw new Error('harus throw');
      } catch (e: any) {
        expect(e.getResponse()).toMatchObject({ error: 'NOT_A_MEMBER' });
      }
    });

    it('token valid + anggota → student + audit QR_SCAN', async () => {
      prisma.student.findUnique.mockResolvedValue({
        id: 'stu-1', nis: 'N9', fullName: 'Budi', classGrade: '5A', photoUrl: null, isActive: true,
      });
      prisma.extracurricularMember.findUnique.mockResolvedValue({ id: 'm1' });
      const res = await service.resolveQrScan('u1', 'tok', EK, '1.2.3.4');
      expect(res.student).toMatchObject({ id: 'stu-1', fullName: 'Budi', classGrade: '5A' });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'QR_SCAN', entityId: 'stu-1' }),
      );
    });
  });

  describe('summary', () => {
    beforeEach(() => {
      prisma.extracurricular.count = vi.fn().mockResolvedValue(3);
      prisma.extracurricularSchedule = {
        ...prisma.extracurricularSchedule,
        count: vi.fn().mockResolvedValue(5),
        findMany: vi.fn().mockResolvedValue([{ extracurricularId: 'e1' }, { extracurricularId: 'e2' }]),
      };
      prisma.attendanceSession.count = vi.fn().mockResolvedValue(1);
      prisma.extracurricularMember.findMany.mockResolvedValue([
        { studentId: 'a' }, { studentId: 'b' }, { studentId: 'c' }, { studentId: 'd' },
      ]);
    });

    it('menghitung total siswa unik, jumlah ekskul, jadwal mingguan & hari ini', async () => {
      const res = await service.summary('u1');
      expect(res).toMatchObject({
        totalStudents: 4,
        totalExtracurriculars: 3,
        weeklySchedules: 5,
        todaySessionCount: 2,
        pendingSubmitToday: 1, // 2 jadwal hari ini - 1 sudah disubmit
      });
      // distinct siswa aktif pada ekskul milik pembina ini
      const memberWhere = prisma.extracurricularMember.findMany.mock.calls[0][0];
      expect(memberWhere).toMatchObject({
        where: { student: { isActive: true }, extracurricular: { isActive: true, defaultCoachId: 'coach-1' } },
        distinct: ['studentId'],
      });
    });

    it('pendingSubmitToday tidak negatif bila semua sudah disubmit', async () => {
      prisma.attendanceSession.count.mockResolvedValue(9);
      const res = await service.summary('u1');
      expect(res.pendingSubmitToday).toBe(0);
    });
  });
});

function isoToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}
