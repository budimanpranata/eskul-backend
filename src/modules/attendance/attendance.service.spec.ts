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
      },
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
});

function isoToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}
