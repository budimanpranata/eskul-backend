import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnalyticsService, ANALYTICS_CACHE_KEY } from './analytics.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { RedisService } from '../../redis/redis.service.js';

const DAY = 86_400_000;

/** Tanggal `d` hari lalu (UTC midnight). */
const daysAgo = (d: number) => new Date(new Date().setUTCHours(0, 0, 0, 0) - d * DAY);

function makePrisma(over: {
  ekskuls?: unknown[];
  memberships?: unknown[];
  details?: unknown[];
  students?: unknown[];
  activeStudents?: number;
  pending?: number;
}) {
  return {
    extracurricular: { findMany: vi.fn().mockResolvedValue(over.ekskuls ?? []) },
    extracurricularMember: { findMany: vi.fn().mockResolvedValue(over.memberships ?? []) },
    attendanceDetail: { findMany: vi.fn().mockResolvedValue(over.details ?? []) },
    student: {
      count: vi.fn().mockResolvedValue(over.activeStudents ?? 0),
      findMany: vi.fn().mockResolvedValue(over.students ?? []),
    },
    parentStudentRelation: { count: vi.fn().mockResolvedValue(over.pending ?? 0) },
  } as unknown as PrismaService & Record<string, any>;
}

function makeRedis() {
  const store = new Map<string, string>();
  return {
    client: {
      get: vi.fn((k: string) => Promise.resolve(store.get(k) ?? null)),
      set: vi.fn((k: string, v: string) => {
        store.set(k, v);
        return Promise.resolve('OK');
      }),
    },
    _store: store,
  } as unknown as RedisService & { _store: Map<string, string> };
}

describe('AnalyticsService.overview', () => {
  let redis: ReturnType<typeof makeRedis>;

  // Bekukan jam ke Kamis 2026-01-01 12:00 UTC: `daysAgo(1..3)` semua tetap di
  // minggu berjalan (Senin 2025-12-29) apa pun hari nyata saat CI berjalan.
  beforeAll(() => vi.setSystemTime(new Date('2026-01-01T12:00:00.000Z')));
  afterAll(() => vi.useRealTimers());

  beforeEach(() => {
    redis = makeRedis();
  });

  it('cache MISS → menghitung, menulis cache TTL 1 jam, cached:false', async () => {
    const prisma = makePrisma({ ekskuls: [], activeStudents: 10 });
    const svc = new AnalyticsService(prisma, redis);

    const res = await svc.overview();

    expect(res.cached).toBe(false);
    expect(res.kpi.activeStudents).toBe(10);
    expect(redis.client.set).toHaveBeenCalledWith(
      `${ANALYTICS_CACHE_KEY}:all`,
      expect.any(String),
      'EX',
      3600,
    );
  });

  it('cache HIT → mengembalikan payload cache, cached:true, tanpa query DB', async () => {
    const prisma = makePrisma({});
    redis._store.set(`${ANALYTICS_CACHE_KEY}:all`, JSON.stringify({ kpi: { activeStudents: 99 } }));
    const svc = new AnalyticsService(prisma, redis);

    const res = await svc.overview();

    expect(res.cached).toBe(true);
    expect(res.kpi.activeStudents).toBe(99);
    expect((prisma as any).attendanceDetail.findMany).not.toHaveBeenCalled();
  });

  it('fresh:true → melewati cache walau ada isinya', async () => {
    const prisma = makePrisma({ activeStudents: 7 });
    redis._store.set(`${ANALYTICS_CACHE_KEY}:all`, JSON.stringify({ kpi: { activeStudents: 99 } }));
    const svc = new AnalyticsService(prisma, redis);

    const res = await svc.overview({ fresh: true });

    expect(res.cached).toBe(false);
    expect(res.kpi.activeStudents).toBe(7);
    expect((prisma as any).attendanceDetail.findMany).toHaveBeenCalled();
  });

  it('partisipasi per kategori: hitung ekskul, membership, siswa unik; null → LAINNYA', async () => {
    const prisma = makePrisma({
      ekskuls: [
        { id: 'e1', name: 'Sepak Bola', category: 'OLAHRAGA' },
        { id: 'e2', name: 'Futsal', category: 'OLAHRAGA' },
        { id: 'e3', name: 'Paduan Suara', category: null },
      ],
      memberships: [
        { studentId: 's1', extracurricularId: 'e1', extracurricular: { category: 'OLAHRAGA' } },
        { studentId: 's2', extracurricularId: 'e1', extracurricular: { category: 'OLAHRAGA' } },
        { studentId: 's1', extracurricularId: 'e2', extracurricular: { category: 'OLAHRAGA' } },
        { studentId: 's3', extracurricularId: 'e3', extracurricular: { category: null } },
      ],
    });
    const svc = new AnalyticsService(prisma, redis);
    const { participationByCategory: p } = await svc.overview({ fresh: true });

    const olah = p.find((x) => x.category === 'OLAHRAGA')!;
    expect(olah).toMatchObject({ extracurriculars: 2, memberships: 3, distinctStudents: 2 });
    expect(p.find((x) => x.category === 'LAINNYA')).toMatchObject({
      extracurriculars: 1,
      memberships: 1,
      distinctStudents: 1,
    });
    // terurut desc berdasarkan membership
    expect(p[0].category).toBe('OLAHRAGA');
  });

  it('tren kehadiran: selalu 8 minggu berurutan, %hadir per minggu benar', async () => {
    const prisma = makePrisma({
      details: [
        // minggu ini: 2 HADIR + 2 ALPA → 50%
        { status: 'HADIR', studentId: 's1', session: { id: 'a', sessionDate: daysAgo(1), extracurricularId: 'e1' } },
        { status: 'HADIR', studentId: 's2', session: { id: 'a', sessionDate: daysAgo(1), extracurricularId: 'e1' } },
        { status: 'ALPA', studentId: 's3', session: { id: 'a', sessionDate: daysAgo(1), extracurricularId: 'e1' } },
        { status: 'ALPA', studentId: 's4', session: { id: 'a', sessionDate: daysAgo(2), extracurricularId: 'e1' } },
      ],
    });
    const svc = new AnalyticsService(prisma, redis);
    const { attendanceTrend: t } = await svc.overview({ fresh: true });

    expect(t).toHaveLength(8);
    const last = t[7];
    expect(last.avgAttendancePct).toBe(50);
    expect(last.records).toBe(4);
    expect(last.sessions).toBe(1);
    // minggu tanpa data → 0, bukan NaN/error
    expect(t[0]).toMatchObject({ avgAttendancePct: 0, records: 0, sessions: 0 });
    // urutan kronologis
    expect(new Date(t[0].weekStart).getTime()).toBeLessThan(new Date(t[7].weekStart).getTime());
  });

  it('top-5 kehadiran terendah per ekskul, urut menaik, diperkaya nama siswa', async () => {
    const mk = (sid: string, st: string) => ({
      status: st,
      studentId: sid,
      session: { id: `sess-${sid}-${st}-${Math.random()}`, sessionDate: daysAgo(3), extracurricularId: 'e1' },
    });
    const details = [
      ...Array(10).fill(0).map(() => mk('low', 'ALPA')),
      mk('low', 'HADIR'), // low: 1/11 ≈ 9.1%
      ...Array(5).fill(0).map(() => mk('mid', 'HADIR')),
      ...Array(5).fill(0).map(() => mk('mid', 'ALPA')), // mid: 5/10 = 50%
      ...Array(9).fill(0).map(() => mk('high', 'HADIR')),
      mk('high', 'ALPA'), // high: 9/10 = 90%
    ];
    const prisma = makePrisma({
      details,
      ekskuls: [{ id: 'e1', name: 'Sepak Bola', category: 'OLAHRAGA' }],
      students: [
        { id: 'low', nis: 'N-low', fullName: 'Andi Rendah', classGrade: '4A' },
        { id: 'mid', nis: 'N-mid', fullName: 'Budi Sedang', classGrade: '4B' },
        { id: 'high', nis: 'N-high', fullName: 'Cici Tinggi', classGrade: '4C' },
      ],
    });
    const svc = new AnalyticsService(prisma, redis);
    const { lowAttendanceByExtracurricular: low } = await svc.overview({ fresh: true });

    expect(low).toHaveLength(1);
    const rows = low[0].students;
    expect(rows.map((r) => r.studentId)).toEqual(['low', 'mid', 'high']);
    expect(rows[0]).toMatchObject({ fullName: 'Andi Rendah', attendancePct: 9.1, recordedSessions: 11, present: 1 });
    expect(low[0].extracurricularName).toBe('Sepak Bola');
  });

  it('tanpa data sama sekali → KPI nol, array kosong, tidak error', async () => {
    const svc = new AnalyticsService(makePrisma({}), redis);
    const res = await svc.overview({ fresh: true });
    expect(res.kpi).toMatchObject({
      activeStudents: 0,
      activeExtracurriculars: 0,
      studentsInAnyExtracurricular: 0,
      avgAttendancePctWindow: 0,
    });
    expect(res.participationByCategory).toEqual([]);
    expect(res.lowAttendanceByExtracurricular).toEqual([]);
    expect(res.attendanceTrend).toHaveLength(8);
  });
});
