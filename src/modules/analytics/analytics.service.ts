import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service.js';
import { RedisService } from '../../redis/redis.service.js';

export const ANALYTICS_CACHE_KEY = 'analytics:overview:v1';
export const ANALYTICS_CACHE_TTL_SECONDS = 3600; // data agregat tidak perlu real-time (DoD 3.2)
const TREND_WEEKS = 8;
const LOW_ATTENDANCE_TOP_N = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

type Status = 'HADIR' | 'IZIN' | 'SAKIT' | 'ALPA';

interface OverviewPayload {
  generatedAt: string;
  range: { weeks: number; from: string; to: string };
  kpi: {
    activeStudents: number;
    activeExtracurriculars: number;
    studentsInAnyExtracurricular: number;
    avgAttendancePctWindow: number;
    pendingParentRelations: number;
  };
  participationByCategory: {
    category: string;
    extracurriculars: number;
    memberships: number;
    distinctStudents: number;
  }[];
  attendanceTrend: {
    weekStart: string;
    label: string;
    avgAttendancePct: number;
    sessions: number;
    records: number;
  }[];
  lowAttendanceByExtracurricular: {
    extracurricularId: string;
    extracurricularName: string;
    students: {
      studentId: string;
      nis: string;
      fullName: string;
      classGrade: string;
      recordedSessions: number;
      present: number;
      attendancePct: number;
    }[];
  }[];
}

function jakartaToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}

const ID_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function mondayOfWeekUTC(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = x.getUTCDay();
  x.setUTCDate(x.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return x;
}

/**
 * Dashboard Analitik Sekolah (Fase 3.2). Semua angka dihitung dari window
 * 8 minggu terakhir agar tetap < 2 detik walau riwayat 1 tahun ajaran penuh,
 * lalu di-cache di Redis TTL 1 jam.
 */
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async overview(opts: { fresh?: boolean } = {}): Promise<OverviewPayload & { cached: boolean }> {
    if (!opts.fresh) {
      const cached = await this.redis.client.get(ANALYTICS_CACHE_KEY).catch(() => null);
      if (cached) {
        try {
          return { ...(JSON.parse(cached) as OverviewPayload), cached: true };
        } catch {
          /* cache korup → hitung ulang */
        }
      }
    }

    const data = await this.compute();
    await this.redis.client
      .set(ANALYTICS_CACHE_KEY, JSON.stringify(data), 'EX', ANALYTICS_CACHE_TTL_SECONDS)
      .catch((err: Error) => this.logger.warn(`Gagal menulis cache analitik: ${err.message}`));
    return { ...data, cached: false };
  }

  private async compute(): Promise<OverviewPayload> {
    const toStr = jakartaToday();
    const toDate = new Date(`${toStr}T00:00:00.000Z`);
    const currentMonday = mondayOfWeekUTC(toDate);
    const fromDate = new Date(currentMonday.getTime() - (TREND_WEEKS - 1) * 7 * DAY_MS);
    const fromStr = fromDate.toISOString().slice(0, 10);

    const [ekskuls, memberships, details, activeStudents, pendingRelations] = await Promise.all([
      this.prisma.extracurricular.findMany({
        where: { isActive: true },
        select: { id: true, name: true, category: true },
      }),
      this.prisma.extracurricularMember.findMany({
        where: { student: { isActive: true }, extracurricular: { isActive: true } },
        select: { studentId: true, extracurricularId: true, extracurricular: { select: { category: true } } },
      }),
      this.prisma.attendanceDetail.findMany({
        where: {
          session: {
            status: { in: ['SUBMITTED', 'SYNCED'] },
            sessionDate: { gte: fromDate, lte: toDate },
          },
        },
        select: {
          status: true,
          studentId: true,
          session: { select: { id: true, sessionDate: true, extracurricularId: true } },
        },
      }),
      this.prisma.student.count({ where: { isActive: true } }),
      this.prisma.parentStudentRelation.count({ where: { approvalStatus: 'PENDING' } }),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      range: { weeks: TREND_WEEKS, from: fromStr, to: toStr },
      kpi: this.buildKpi(ekskuls, memberships, details, activeStudents, pendingRelations),
      participationByCategory: this.buildParticipation(ekskuls, memberships),
      attendanceTrend: this.buildTrend(details, currentMonday),
      lowAttendanceByExtracurricular: await this.buildLowAttendance(details, ekskuls),
    };
  }

  private buildKpi(
    ekskuls: { id: string }[],
    memberships: { studentId: string }[],
    details: { status: string }[],
    activeStudents: number,
    pendingRelations: number,
  ): OverviewPayload['kpi'] {
    const present = details.filter((d) => d.status === 'HADIR').length;
    return {
      activeStudents,
      activeExtracurriculars: ekskuls.length,
      studentsInAnyExtracurricular: new Set(memberships.map((m) => m.studentId)).size,
      avgAttendancePctWindow: details.length
        ? Math.round((present / details.length) * 1000) / 10
        : 0,
      pendingParentRelations: pendingRelations,
    };
  }

  private buildParticipation(
    ekskuls: { id: string; category: string | null }[],
    memberships: { studentId: string; extracurricular: { category: string | null } }[],
  ): OverviewPayload['participationByCategory'] {
    const norm = (c: string | null) => c?.trim() || 'LAINNYA';
    const map = new Map<
      string,
      { extracurriculars: number; memberships: number; students: Set<string> }
    >();
    const get = (cat: string) => {
      let e = map.get(cat);
      if (!e) {
        e = { extracurriculars: 0, memberships: 0, students: new Set() };
        map.set(cat, e);
      }
      return e;
    };
    for (const e of ekskuls) get(norm(e.category)).extracurriculars += 1;
    for (const m of memberships) {
      const e = get(norm(m.extracurricular.category));
      e.memberships += 1;
      e.students.add(m.studentId);
    }
    return [...map.entries()]
      .map(([category, v]) => ({
        category,
        extracurriculars: v.extracurriculars,
        memberships: v.memberships,
        distinctStudents: v.students.size,
      }))
      .sort((a, b) => b.memberships - a.memberships);
  }

  private buildTrend(
    details: { status: string; session: { id: string; sessionDate: Date } }[],
    currentMonday: Date,
  ): OverviewPayload['attendanceTrend'] {
    const weeks: OverviewPayload['attendanceTrend'] = [];
    for (let i = TREND_WEEKS - 1; i >= 0; i--) {
      const start = new Date(currentMonday.getTime() - i * 7 * DAY_MS);
      const end = new Date(start.getTime() + 7 * DAY_MS);
      const inWeek = details.filter(
        (d) => d.session.sessionDate >= start && d.session.sessionDate < end,
      );
      const present = inWeek.filter((d) => d.status === 'HADIR').length;
      weeks.push({
        weekStart: start.toISOString().slice(0, 10),
        label: `${start.getUTCDate()} ${ID_MONTHS[start.getUTCMonth()]}`,
        avgAttendancePct: inWeek.length ? Math.round((present / inWeek.length) * 1000) / 10 : 0,
        sessions: new Set(inWeek.map((d) => d.session.id)).size,
        records: inWeek.length,
      });
    }
    return weeks;
  }

  private async buildLowAttendance(
    details: {
      status: string;
      studentId: string;
      session: { extracurricularId: string };
    }[],
    ekskuls: { id: string; name: string }[],
  ): Promise<OverviewPayload['lowAttendanceByExtracurricular']> {
    // Agregasi kehadiran per (ekskul, siswa) di window.
    const agg = new Map<string, { present: number; recorded: number }>();
    for (const d of details) {
      const key = `${d.session.extracurricularId}|${d.studentId}`;
      const a = agg.get(key) ?? { present: 0, recorded: 0 };
      a.recorded += 1;
      if (d.status === 'HADIR') a.present += 1;
      agg.set(key, a);
    }

    interface StudentPct {
      studentId: string;
      recorded: number;
      present: number;
      pct: number;
    }
    const perEkskul = new Map<string, StudentPct[]>();
    for (const [key, a] of agg) {
      const [ekskulId, studentId] = key.split('|');
      const pct = Math.round((a.present / a.recorded) * 1000) / 10;
      const list = perEkskul.get(ekskulId) ?? [];
      list.push({ studentId, recorded: a.recorded, present: a.present, pct });
      perEkskul.set(ekskulId, list);
    }

    const neededStudentIds = new Set<string>();
    const trimmed = new Map<string, StudentPct[]>();
    for (const [ekskulId, list] of perEkskul) {
      const top = list
        .sort((x, y) => x.pct - y.pct || y.recorded - x.recorded)
        .slice(0, LOW_ATTENDANCE_TOP_N);
      trimmed.set(ekskulId, top);
      for (const s of top) neededStudentIds.add(s.studentId);
    }

    const students = neededStudentIds.size
      ? await this.prisma.student.findMany({
          where: { id: { in: [...neededStudentIds] } },
          select: { id: true, nis: true, fullName: true, classGrade: true },
        })
      : [];
    const byId = new Map(students.map((s) => [s.id, s]));
    const ekskulName = new Map(ekskuls.map((e) => [e.id, e.name]));

    return [...trimmed.entries()]
      .map(([extracurricularId, list]) => ({
        extracurricularId,
        extracurricularName: ekskulName.get(extracurricularId) ?? '(ekskul nonaktif)',
        students: list
          .map((s) => {
            const st = byId.get(s.studentId);
            return st
              ? {
                  studentId: s.studentId,
                  nis: st.nis,
                  fullName: st.fullName,
                  classGrade: st.classGrade,
                  recordedSessions: s.recorded,
                  present: s.present,
                  attendancePct: s.pct,
                }
              : null;
          })
          .filter((x): x is NonNullable<typeof x> => x !== null),
      }))
      .filter((e) => e.students.length > 0)
      .sort((a, b) => a.students[0].attendancePct - b.students[0].attendancePct);
  }
}

export type { OverviewPayload, Status };
