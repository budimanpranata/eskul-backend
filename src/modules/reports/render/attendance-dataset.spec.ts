import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../prisma/prisma.service.js';
import { buildAttendanceDataset, resolveRange } from './attendance-dataset.js';

function mkPrisma(over: {
  members?: unknown[];
  sessions?: unknown[];
  details?: unknown[];
}) {
  return {
    extracurricularMember: { findMany: vi.fn().mockResolvedValue(over.members ?? []) },
    attendanceSession: { findMany: vi.fn().mockResolvedValue(over.sessions ?? []) },
    attendanceDetail: { findMany: vi.fn().mockResolvedValue(over.details ?? []) },
  } as unknown as PrismaService & Record<string, any>;
}

const member = (studentId: string, ekskulId: string, extra: Record<string, unknown> = {}) => ({
  studentId,
  extracurricularId: ekskulId,
  student: { nis: `NIS-${studentId}`, fullName: `Siswa ${studentId}`, classGrade: '4A' },
  extracurricular: {
    name: `Ekskul ${ekskulId}`,
    category: 'OLAHRAGA',
    defaultCoach: { user: { fullName: 'Pak Budi' } },
  },
  ...extra,
});

describe('resolveRange', () => {
  it('default: 180 hari terakhir s/d hari ini bila filter kosong', () => {
    const { dateFrom, dateTo } = resolveRange({});
    expect(dateTo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const days = (Date.parse(dateTo) - Date.parse(dateFrom)) / 86_400_000;
    expect(days).toBe(180);
  });

  it('memakai dateFrom/dateTo eksplisit apa adanya', () => {
    expect(resolveRange({ dateFrom: '2026-01-01', dateTo: '2026-03-01' })).toEqual({
      dateFrom: '2026-01-01',
      dateTo: '2026-03-01',
    });
  });
});

describe('buildAttendanceDataset', () => {
  it('agregasi per (siswa, ekskul): hadir/izin/sakit/alpa, %kehadiran, rata2 keaktifan', async () => {
    const prisma = mkPrisma({
      members: [member('s1', 'e1')],
      sessions: [
        { id: 'ses1', extracurricularId: 'e1' },
        { id: 'ses2', extracurricularId: 'e1' },
        { id: 'ses3', extracurricularId: 'e1' },
        { id: 'ses4', extracurricularId: 'e1' },
      ],
      details: [
        { sessionId: 'ses1', studentId: 's1', status: 'HADIR', activenessScore: 5, skillNotes: 'Passing bagus', personalNotes: null },
        { sessionId: 'ses2', studentId: 's1', status: 'HADIR', activenessScore: 3, skillNotes: null, personalNotes: null },
        { sessionId: 'ses3', studentId: 's1', status: 'HADIR', activenessScore: null, skillNotes: null, personalNotes: 'Kurang fokus' },
        { sessionId: 'ses4', studentId: 's1', status: 'ALPA', activenessScore: null, skillNotes: null, personalNotes: null },
      ],
    });

    const ds = await buildAttendanceDataset(prisma, { dateFrom: '2026-01-01', dateTo: '2026-06-01' }, undefined);
    expect(ds.rows).toHaveLength(1);
    const r = ds.rows[0];
    expect(r).toMatchObject({
      studentName: 'Siswa s1',
      extracurricularName: 'Ekskul e1',
      coachName: 'Pak Budi',
      totalSessions: 4,
      recordedSessions: 4,
      present: 3,
      alpa: 1,
      attendancePct: 75,
      avgActiveness: 4, // (5 + 3) / 2
    });
    expect(r.notes).toEqual(['Passing bagus', 'Kurang fokus']);
  });

  it('siswa tanpa detail presensi → semua nol, %=0, rata2=null', async () => {
    const prisma = mkPrisma({
      members: [member('s2', 'e1')],
      sessions: [{ id: 'ses1', extracurricularId: 'e1' }],
      details: [],
    });
    const ds = await buildAttendanceDataset(prisma, {}, undefined);
    expect(ds.rows[0]).toMatchObject({
      totalSessions: 1,
      recordedSessions: 0,
      present: 0,
      attendancePct: 0,
      avgActiveness: null,
      notes: [],
    });
  });

  it('detail hanya diakumulasi ke ekskul yang sesuai (via session → extracurricularId)', async () => {
    const prisma = mkPrisma({
      members: [member('s1', 'e1'), member('s1', 'e2')],
      sessions: [
        { id: 'a', extracurricularId: 'e1' },
        { id: 'b', extracurricularId: 'e2' },
      ],
      details: [
        { sessionId: 'a', studentId: 's1', status: 'HADIR', activenessScore: 4, skillNotes: null, personalNotes: null },
        { sessionId: 'b', studentId: 's1', status: 'ALPA', activenessScore: null, skillNotes: null, personalNotes: null },
      ],
    });
    const ds = await buildAttendanceDataset(prisma, {}, undefined);
    const e1 = ds.rows.find((r) => r.extracurricularId === 'e1')!;
    const e2 = ds.rows.find((r) => r.extracurricularId === 'e2')!;
    expect(e1).toMatchObject({ present: 1, alpa: 0, attendancePct: 100 });
    expect(e2).toMatchObject({ present: 0, alpa: 1, attendancePct: 0 });
  });

  it('meneruskan filter kelas & ekskul ke query member', async () => {
    const prisma = mkPrisma({ members: [] });
    await buildAttendanceDataset(prisma, { classGrade: '5B', extracurricularId: 'e9' }, undefined);
    const where = (prisma as any).extracurricularMember.findMany.mock.calls[0][0].where;
    expect(where.student.classGrade).toBe('5B');
    expect(where.extracurricular.id).toBe('e9');
  });

  it('tanpa anggota → tidak query sesi/detail, rows kosong', async () => {
    const prisma = mkPrisma({ members: [] });
    const ds = await buildAttendanceDataset(prisma, {}, undefined);
    expect(ds.rows).toEqual([]);
    expect((prisma as any).attendanceSession.findMany).not.toHaveBeenCalled();
    expect((prisma as any).attendanceDetail.findMany).not.toHaveBeenCalled();
  });
});
