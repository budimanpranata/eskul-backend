import type { PrismaService } from '../../../prisma/prisma.service.js';

export interface ReportFilters {
  classGrade?: string;
  extracurricularId?: string;
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string; // YYYY-MM-DD
}

/** Satu baris = satu siswa pada satu ekstrakurikuler (data mentah tabular). */
export interface AttendanceReportRow {
  studentId: string;
  nis: string;
  studentName: string;
  classGrade: string;
  extracurricularId: string;
  extracurricularName: string;
  category: string | null;
  coachName: string | null;
  totalSessions: number; // sesi ekskul tsb dalam rentang tanggal
  recordedSessions: number; // sesi yang mencatat siswa ini
  present: number;
  izin: number;
  sakit: number;
  alpa: number;
  attendancePct: number; // present / recordedSessions * 100 (0 bila belum ada)
  avgActiveness: number | null;
  notes: string[];
}

export interface AttendanceReportDataset {
  filters: Required<Pick<ReportFilters, 'dateFrom' | 'dateTo'>> & ReportFilters;
  generatedAt: string;
  rows: AttendanceReportRow[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_NOTES_PER_ROW = 6;
const NOTE_MAX_LEN = 200;

function jakartaToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}

/** Rentang tanggal efektif: default 180 hari terakhir s/d hari ini (Asia/Jakarta). */
export function resolveRange(f: ReportFilters): { dateFrom: string; dateTo: string } {
  const dateTo = f.dateTo ?? jakartaToday();
  const dateFrom =
    f.dateFrom ?? new Date(new Date(`${dateTo}T00:00:00.000Z`).getTime() - 180 * DAY_MS).toISOString().slice(0, 10);
  return { dateFrom, dateTo };
}

/**
 * Query data presensi + evaluasi sesuai filter, lalu agregasi per (siswa, ekskul).
 * Dipakai baik untuk preview tabel maupun untuk generate file export.
 */
export async function buildAttendanceDataset(
  prisma: PrismaService,
  filters: ReportFilters,
  /** `undefined` HANYA untuk ADMIN_SUPER (lintas sekolah) — lihat `tenantScope()`. */
  schoolScope: string | undefined,
): Promise<AttendanceReportDataset> {
  const { dateFrom, dateTo } = resolveRange(filters);
  const from = new Date(`${dateFrom}T00:00:00.000Z`);
  const to = new Date(`${dateTo}T00:00:00.000Z`);

  const members = await prisma.extracurricularMember.findMany({
    where: {
      student: {
        isActive: true,
        ...(schoolScope !== undefined ? { schoolId: schoolScope } : {}),
        ...(filters.classGrade ? { classGrade: filters.classGrade } : {}),
      },
      extracurricular: {
        isActive: true,
        ...(schoolScope !== undefined ? { schoolId: schoolScope } : {}),
        ...(filters.extracurricularId ? { id: filters.extracurricularId } : {}),
      },
    },
    select: {
      studentId: true,
      extracurricularId: true,
      student: { select: { nis: true, fullName: true, classGrade: true } },
      extracurricular: {
        select: {
          name: true,
          category: true,
          defaultCoach: { select: { user: { select: { fullName: true } } } },
        },
      },
    },
    orderBy: [{ student: { classGrade: 'asc' } }, { student: { fullName: 'asc' } }],
  });

  const studentIds = [...new Set(members.map((m) => m.studentId))];
  const ekskulIds = [...new Set(members.map((m) => m.extracurricularId))];

  const sessions =
    ekskulIds.length === 0
      ? []
      : await prisma.attendanceSession.findMany({
          where: {
            extracurricularId: { in: ekskulIds },
            status: { in: ['SUBMITTED', 'SYNCED'] },
            sessionDate: { gte: from, lte: to },
          },
          select: { id: true, extracurricularId: true },
        });

  const sessionCountByEkskul = new Map<string, number>();
  for (const s of sessions) {
    sessionCountByEkskul.set(s.extracurricularId, (sessionCountByEkskul.get(s.extracurricularId) ?? 0) + 1);
  }
  const sessionIds = sessions.map((s) => s.id);
  const sessionEkskul = new Map(sessions.map((s) => [s.id, s.extracurricularId]));

  const details =
    sessionIds.length === 0 || studentIds.length === 0
      ? []
      : await prisma.attendanceDetail.findMany({
          where: { sessionId: { in: sessionIds }, studentId: { in: studentIds } },
          select: {
            sessionId: true,
            studentId: true,
            status: true,
            activenessScore: true,
            skillNotes: true,
            personalNotes: true,
          },
        });

  interface Agg {
    recorded: number;
    present: number;
    izin: number;
    sakit: number;
    alpa: number;
    scoreSum: number;
    scoreN: number;
    notes: string[];
  }
  const aggByKey = new Map<string, Agg>();
  const key = (studentId: string, ekskulId: string) => `${studentId}|${ekskulId}`;

  for (const d of details) {
    const ekskulId = sessionEkskul.get(d.sessionId);
    if (!ekskulId) continue;
    const k = key(d.studentId, ekskulId);
    let a = aggByKey.get(k);
    if (!a) {
      a = { recorded: 0, present: 0, izin: 0, sakit: 0, alpa: 0, scoreSum: 0, scoreN: 0, notes: [] };
      aggByKey.set(k, a);
    }
    a.recorded += 1;
    if (d.status === 'HADIR') a.present += 1;
    else if (d.status === 'IZIN') a.izin += 1;
    else if (d.status === 'SAKIT') a.sakit += 1;
    else if (d.status === 'ALPA') a.alpa += 1;
    if (d.activenessScore != null) {
      a.scoreSum += d.activenessScore;
      a.scoreN += 1;
    }
    for (const n of [d.skillNotes, d.personalNotes]) {
      const t = n?.trim();
      if (t && a.notes.length < MAX_NOTES_PER_ROW) {
        a.notes.push(t.length > NOTE_MAX_LEN ? t.slice(0, NOTE_MAX_LEN) + '…' : t);
      }
    }
  }

  const rows: AttendanceReportRow[] = members.map((m) => {
    const a = aggByKey.get(key(m.studentId, m.extracurricularId));
    const recorded = a?.recorded ?? 0;
    const present = a?.present ?? 0;
    return {
      studentId: m.studentId,
      nis: m.student.nis,
      studentName: m.student.fullName,
      classGrade: m.student.classGrade,
      extracurricularId: m.extracurricularId,
      extracurricularName: m.extracurricular.name,
      category: m.extracurricular.category,
      coachName: m.extracurricular.defaultCoach?.user.fullName ?? null,
      totalSessions: sessionCountByEkskul.get(m.extracurricularId) ?? 0,
      recordedSessions: recorded,
      present,
      izin: a?.izin ?? 0,
      sakit: a?.sakit ?? 0,
      alpa: a?.alpa ?? 0,
      attendancePct: recorded > 0 ? Math.round((present / recorded) * 1000) / 10 : 0,
      avgActiveness: a && a.scoreN > 0 ? Math.round((a.scoreSum / a.scoreN) * 10) / 10 : null,
      notes: a?.notes ?? [],
    };
  });

  return {
    filters: { ...filters, dateFrom, dateTo },
    generatedAt: new Date().toISOString(),
    rows,
  };
}
