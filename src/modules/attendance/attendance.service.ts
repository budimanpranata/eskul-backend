import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { formatTimeOfDay, parseTimeOfDay } from '../../common/util/time-of-day.js';
import { bucketActivenessTrend } from '../parents/parents.service.js';
import type { SubmitAttendanceDto } from './dto/submit-attendance.dto.js';

interface Actor {
  userId: string;
  ip: string | null;
}

type StatusCode = 'HADIR' | 'IZIN' | 'SAKIT' | 'ALPA';

const DAY_LABELS = ['', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** GET /coach/summary — angka ringkas untuk dashboard Pembina. */
  async summary(userId: string) {
    const coach = await this.getCoachOrThrow(userId);
    const todayStr = jakartaToday();
    const dow = isoDayOfWeek(todayStr);
    const sessionDate = new Date(`${todayStr}T00:00:00.000Z`);
    const ekskulWhere = { isActive: true, defaultCoachId: coach.id };

    const [distinctStudents, extracurriculars, weeklySchedules, todaySchedules] = await Promise.all([
      this.prisma.extracurricularMember.findMany({
        where: { student: { isActive: true }, extracurricular: ekskulWhere },
        select: { studentId: true },
        distinct: ['studentId'],
      }),
      this.prisma.extracurricular.count({ where: ekskulWhere }),
      this.prisma.extracurricularSchedule.count({
        where: { isActive: true, extracurricular: ekskulWhere },
      }),
      this.prisma.extracurricularSchedule.findMany({
        where: { isActive: true, dayOfWeek: dow, extracurricular: ekskulWhere },
        select: { extracurricularId: true },
      }),
    ]);

    const submittedToday = await this.prisma.attendanceSession.count({
      where: {
        coachId: coach.id,
        sessionDate,
        extracurricularId: { in: todaySchedules.map((s) => s.extracurricularId) },
      },
    });

    return {
      date: todayStr,
      dayLabel: DAY_LABELS[dow],
      totalStudents: distinctStudents.length,
      totalExtracurriculars: extracurriculars,
      weeklySchedules,
      todaySessionCount: todaySchedules.length,
      pendingSubmitToday: Math.max(0, todaySchedules.length - submittedToday),
    };
  }

  /** GET /coach/today-sessions — jadwal ekskul hari ini milik pembina login. */
  async todaySessions(userId: string) {
    const coach = await this.getCoachOrThrow(userId);
    const todayStr = jakartaToday();
    const dow = isoDayOfWeek(todayStr);
    const sessionDate = new Date(`${todayStr}T00:00:00.000Z`);

    const schedules = await this.prisma.extracurricularSchedule.findMany({
      where: {
        isActive: true,
        dayOfWeek: dow,
        extracurricular: { isActive: true, defaultCoachId: coach.id },
      },
      include: {
        extracurricular: {
          select: { id: true, name: true, category: true, _count: { select: { members: true } } },
        },
      },
      orderBy: { startTime: 'asc' },
    });

    const existing = await this.prisma.attendanceSession.findMany({
      where: {
        coachId: coach.id,
        sessionDate,
        extracurricularId: { in: schedules.map((s) => s.extracurricularId) },
      },
      select: { id: true, extracurricularId: true, status: true, submittedAt: true },
    });
    const byEkskul = new Map(existing.map((e) => [e.extracurricularId, e]));

    return {
      date: todayStr,
      dayOfWeek: dow,
      dayLabel: DAY_LABELS[dow],
      sessions: schedules.map((s) => ({
        scheduleId: s.id,
        extracurricularId: s.extracurricular.id,
        extracurricularName: s.extracurricular.name,
        category: s.extracurricular.category,
        startTime: formatTimeOfDay(s.startTime),
        endTime: formatTimeOfDay(s.endTime),
        location: s.location,
        memberCount: s.extracurricular._count.members,
        session: byEkskul.get(s.extracurricularId)
          ? {
              id: byEkskul.get(s.extracurricularId)!.id,
              status: byEkskul.get(s.extracurricularId)!.status,
              submittedAt: byEkskul.get(s.extracurricularId)!.submittedAt,
            }
          : null,
      })),
    };
  }

  /** GET /coach/extracurriculars/:id/roster — daftar siswa aktif untuk presensi. */
  async roster(userId: string, extracurricularId: string) {
    const coach = await this.getCoachOrThrow(userId);
    const ekskul = await this.prisma.extracurricular.findUnique({
      where: { id: extracurricularId },
      select: { id: true, name: true, category: true, isActive: true, defaultCoachId: true },
    });
    if (!ekskul || !ekskul.isActive) throw new NotFoundException('Ekstrakurikuler tidak ditemukan.');
    if (ekskul.defaultCoachId !== coach.id) {
      throw new ForbiddenException('Anda bukan pembina ekstrakurikuler ini.');
    }

    const members = await this.prisma.extracurricularMember.findMany({
      where: { extracurricularId, student: { isActive: true } },
      include: {
        student: { select: { id: true, nis: true, fullName: true, classGrade: true, photoUrl: true } },
      },
      orderBy: { student: { fullName: 'asc' } },
    });

    return {
      extracurricular: { id: ekskul.id, name: ekskul.name, category: ekskul.category },
      students: members.map((m) => m.student),
    };
  }

  /**
   * POST /coach/students/qr-scan — resolusi qr_token → student, khusus untuk
   * ekskul yang diampu pembina. Token yang sudah dirotasi tidak akan cocok
   * (lookup berdasarkan string qr_token yang tersimpan saat ini).
   */
  async resolveQrScan(
    userId: string,
    qrToken: string,
    extracurricularId: string,
    ip: string | null,
  ) {
    const coach = await this.getCoachOrThrow(userId);
    const ekskul = await this.prisma.extracurricular.findUnique({
      where: { id: extracurricularId },
      select: { id: true, isActive: true, defaultCoachId: true },
    });
    if (!ekskul || !ekskul.isActive) throw new NotFoundException('Ekstrakurikuler tidak ditemukan.');
    if (ekskul.defaultCoachId !== coach.id) {
      throw new ForbiddenException('Anda bukan pembina ekstrakurikuler ini.');
    }

    const student = await this.prisma.student.findUnique({
      where: { qrToken },
      select: { id: true, nis: true, fullName: true, classGrade: true, photoUrl: true, isActive: true },
    });
    if (!student || !student.isActive) {
      throw new NotFoundException({
        error: 'QR_INVALID',
        message: 'Kartu QR tidak dikenal atau sudah tidak berlaku.',
      });
    }

    const member = await this.prisma.extracurricularMember.findUnique({
      where: { extracurricularId_studentId: { extracurricularId, studentId: student.id } },
      select: { id: true },
    });
    if (!member) {
      throw new UnprocessableEntityException({
        error: 'NOT_A_MEMBER',
        message: `${student.fullName} bukan anggota ekstrakurikuler ini.`,
      });
    }

    await this.audit.log({
      userId,
      action: 'QR_SCAN',
      entityType: 'student',
      entityId: student.id,
      ipAddress: ip,
      metadata: { extracurricularId },
    });

    return {
      student: {
        id: student.id,
        nis: student.nis,
        fullName: student.fullName,
        classGrade: student.classGrade,
        photoUrl: student.photoUrl,
      },
    };
  }

  /** GET /coach/sessions — riwayat sesi yang pernah disubmit pembina (GP-07). */
  async history(userId: string, limit: number) {
    const coach = await this.getCoachOrThrow(userId);
    const rows = await this.prisma.attendanceSession.findMany({
      where: { coachId: coach.id },
      include: {
        extracurricular: { select: { name: true } },
        details: { select: { status: true, activenessScore: true } },
      },
      orderBy: [{ sessionDate: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    });
    return rows.map((r) => {
      const scores = r.details.map((d) => d.activenessScore).filter((s): s is number => s != null);
      return {
        id: r.id,
        extracurricularName: r.extracurricular.name,
        sessionDate: r.sessionDate,
        status: r.status,
        submittedAt: r.submittedAt,
        summary: summarize(r.details.map((d) => d.status as StatusCode)),
        avgActiveness: scores.length
          ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
          : null,
      };
    });
  }

  /**
   * GET /coach/extracurriculars/:id/students — roster + rekap ringkas per siswa
   * (jumlah sesi, %hadir, rata-rata keaktifan). Untuk layar daftar siswa pembina.
   */
  async ekskulStudentStats(userId: string, extracurricularId: string) {
    const coach = await this.getCoachOrThrow(userId);
    const ekskul = await this.assertCoachOwnsEkskul(coach.id, extracurricularId);

    const members = await this.prisma.extracurricularMember.findMany({
      where: { extracurricularId, student: { isActive: true } },
      include: {
        student: { select: { id: true, nis: true, fullName: true, classGrade: true, photoUrl: true } },
      },
      orderBy: { student: { fullName: 'asc' } },
    });
    const studentIds = members.map((m) => m.studentId);

    const details = studentIds.length
      ? await this.prisma.attendanceDetail.findMany({
          where: {
            studentId: { in: studentIds },
            session: { extracurricularId, status: { in: ['SUBMITTED', 'SYNCED'] } },
          },
          select: { studentId: true, status: true, activenessScore: true },
        })
      : [];

    const agg = new Map<string, { present: number; total: number; sum: number; n: number }>();
    for (const d of details) {
      const s = agg.get(d.studentId) ?? { present: 0, total: 0, sum: 0, n: 0 };
      s.total += 1;
      if (d.status === 'HADIR') s.present += 1;
      if (d.activenessScore != null) {
        s.sum += d.activenessScore;
        s.n += 1;
      }
      agg.set(d.studentId, s);
    }

    return {
      extracurricular: { id: ekskul.id, name: ekskul.name },
      students: members.map((m) => {
        const s = agg.get(m.studentId);
        return {
          ...m.student,
          sessions: s?.total ?? 0,
          present: s?.present ?? 0,
          attendance_pct: s && s.total ? Math.round((s.present / s.total) * 1000) / 10 : 0,
          avg_activeness: s && s.n ? Math.round((s.sum / s.n) * 10) / 10 : null,
        };
      }),
    };
  }

  /**
   * GET /coach/extracurriculars/:id/students/:studentId/progress — perkembangan
   * satu siswa DI EKSKUL INI: rekap kehadiran, tren & rata-rata keaktifan, dan
   * daftar penilaian (skor + catatan) yang pembina berikan tiap sesi.
   */
  async coachStudentProgress(
    userId: string,
    extracurricularId: string,
    studentId: string,
    period: 'weekly' | 'monthly',
    ip: string | null,
  ) {
    const coach = await this.getCoachOrThrow(userId);
    const ekskul = await this.assertCoachOwnsEkskul(coach.id, extracurricularId);

    const member = await this.prisma.extracurricularMember.findUnique({
      where: { extracurricularId_studentId: { extracurricularId, studentId } },
      select: {
        student: { select: { id: true, nis: true, fullName: true, classGrade: true, photoUrl: true } },
      },
    });
    if (!member) throw new NotFoundException('Siswa bukan anggota ekstrakurikuler ini.');

    const details = await this.prisma.attendanceDetail.findMany({
      where: {
        studentId,
        session: { extracurricularId, status: { in: ['SUBMITTED', 'SYNCED'] } },
      },
      include: {
        session: {
          select: {
            sessionDate: true,
            materialDescription: true,
            coach: { select: { user: { select: { fullName: true } } } },
          },
        },
      },
      orderBy: { session: { sessionDate: 'asc' } },
    });

    const counts = { hadir: 0, izin: 0, sakit: 0, alpa: 0 };
    for (const d of details) {
      const k = d.status.toLowerCase() as keyof typeof counts;
      if (k in counts) counts[k] += 1;
    }
    const total = details.length;
    const scored = details.filter((d) => d.activenessScore != null);
    const averageActiveness = scored.length
      ? Math.round((scored.reduce((s, d) => s + (d.activenessScore ?? 0), 0) / scored.length) * 10) / 10
      : null;

    const evaluations = details
      .filter((d) => d.activenessScore != null || d.skillNotes || d.personalNotes)
      .slice()
      .reverse()
      .slice(0, 30)
      .map((d) => ({
        date: d.session.sessionDate.toISOString().slice(0, 10),
        activeness_score: d.activenessScore ?? null,
        skill_notes: d.skillNotes ?? null,
        personal_notes: d.personalNotes ?? null,
        coach_name: d.session.coach.user.fullName,
      }));

    await this.audit.log({
      userId,
      action: 'VIEW_STUDENT_DATA',
      entityType: 'student',
      entityId: studentId,
      ipAddress: ip,
      metadata: { via: 'coach-progress', extracurricularId, period },
    });

    return {
      student: {
        id: member.student.id,
        nis: member.student.nis,
        full_name: member.student.fullName,
        class_grade: member.student.classGrade,
        photo_url: member.student.photoUrl,
      },
      extracurricular: { id: ekskul.id, name: ekskul.name },
      period,
      attendance_summary: {
        total_sessions: total,
        hadir: counts.hadir,
        izin: counts.izin,
        sakit: counts.sakit,
        alpa: counts.alpa,
        percentage: total ? Math.round((counts.hadir / total) * 1000) / 10 : 0,
      },
      average_activeness: averageActiveness,
      activeness_trend: bucketActivenessTrend(
        details.map((d) => ({ sessionDate: d.session.sessionDate, status: d.status, score: d.activenessScore })),
        period,
      ),
      evaluations,
    };
  }

  /** POST /attendance/submit — presensi + materi, idempoten (dokumen desain 4.1). */
  async submit(dto: SubmitAttendanceDto, actor: Actor) {
    const coach = await this.getCoachOrThrow(actor.userId);

    // 1. Idempotent replay berdasarkan client_generated_id.
    const replay = await this.prisma.attendanceSession.findUnique({
      where: { clientGeneratedId: dto.client_generated_id },
      select: { id: true },
    });
    if (replay) throw alreadySynced(replay.id);

    // 2. Tanggal tidak boleh di masa depan.
    if (dto.session_date > jakartaToday()) {
      throw new UnprocessableEntityException({
        error: 'VALIDATION_ERROR',
        details: [{ field: 'session_date', message: 'Tanggal sesi tidak boleh di masa depan.' }],
      });
    }

    // 3. Ekskul valid + diampu pembina ini.
    const ekskul = await this.prisma.extracurricular.findUnique({
      where: { id: dto.extracurricular_id },
      select: { id: true, isActive: true, defaultCoachId: true },
    });
    if (!ekskul || !ekskul.isActive) {
      throw new UnprocessableEntityException({
        error: 'VALIDATION_ERROR',
        details: [{ field: 'extracurricular_id', message: 'Ekstrakurikuler tidak ditemukan / nonaktif.' }],
      });
    }
    if (ekskul.defaultCoachId !== coach.id) {
      throw new ForbiddenException('Anda bukan pembina ekstrakurikuler ini.');
    }

    // 4. schedule_id (opsional) harus milik ekskul tsb.
    if (dto.schedule_id) {
      const sched = await this.prisma.extracurricularSchedule.findFirst({
        where: { id: dto.schedule_id, extracurricularId: dto.extracurricular_id },
        select: { id: true },
      });
      if (!sched) {
        throw new UnprocessableEntityException({
          error: 'VALIDATION_ERROR',
          details: [{ field: 'schedule_id', message: 'Jadwal tidak sesuai dengan ekstrakurikuler.' }],
        });
      }
    }

    // 5. Validasi daftar presensi.
    const details: { field: string; message: string }[] = [];
    const seen = new Set<string>();
    dto.attendances.forEach((a, i) => {
      if (seen.has(a.student_id)) {
        details.push({ field: `attendances[${i}].student_id`, message: 'student_id duplikat dalam daftar.' });
      }
      seen.add(a.student_id);
    });
    const memberRows = await this.prisma.extracurricularMember.findMany({
      where: { extracurricularId: dto.extracurricular_id, studentId: { in: [...seen] } },
      select: { studentId: true, student: { select: { isActive: true } } },
    });
    const memberSet = new Map(memberRows.map((m) => [m.studentId, m.student.isActive]));
    dto.attendances.forEach((a, i) => {
      if (!memberSet.has(a.student_id)) {
        details.push({
          field: `attendances[${i}].student_id`,
          message: 'Siswa bukan anggota ekstrakurikuler ini.',
        });
      } else if (memberSet.get(a.student_id) === false) {
        details.push({ field: `attendances[${i}].student_id`, message: 'Siswa berstatus nonaktif.' });
      }
      // Nilai keaktifan hanya relevan untuk siswa HADIR (Fase 2.3).
      if (a.status !== 'HADIR' && a.activeness_score != null) {
        details.push({
          field: `attendances[${i}].activeness_score`,
          message: 'Nilai keaktifan hanya boleh diisi untuk siswa berstatus HADIR.',
        });
      }
    });
    if (details.length) {
      throw new UnprocessableEntityException({ error: 'VALIDATION_ERROR', details });
    }

    // 6. Sesi untuk (ekskul, tanggal, pembina) sudah ada? (UNIQUE constraint)
    const sessionDate = new Date(`${dto.session_date}T00:00:00.000Z`);
    const dup = await this.prisma.attendanceSession.findFirst({
      where: { extracurricularId: dto.extracurricular_id, sessionDate, coachId: coach.id },
      select: { id: true },
    });
    if (dup) throw alreadySynced(dup.id);

    // 7. Simpan.
    const submittedAt = new Date();
    let sessionId: string;
    try {
      sessionId = await this.prisma.$transaction(async (tx) => {
        const session = await tx.attendanceSession.create({
          data: {
            extracurricularId: dto.extracurricular_id,
            coachId: coach.id,
            scheduleId: dto.schedule_id ?? null,
            sessionDate,
            startTime: dto.start_time ? parseTimeOfDay(dto.start_time) : null,
            endTime: dto.end_time ? parseTimeOfDay(dto.end_time) : null,
            location: dto.location ?? null,
            materialDescription: dto.material?.description ?? null,
            durationMinutes: dto.material?.duration_minutes ?? null,
            targetAchievement: dto.material?.target_achievement ?? null,
            status: 'SUBMITTED',
            clientGeneratedId: dto.client_generated_id,
            submittedAt,
          },
          select: { id: true },
        });
        await tx.attendanceDetail.createMany({
          data: dto.attendances.map((a) => ({
            sessionId: session.id,
            studentId: a.student_id,
            status: a.status,
            // activeness_score hanya relevan bila HADIR (aturan penuh di Fase 2.3).
            activenessScore: a.status === 'HADIR' ? (a.activeness_score ?? null) : null,
            skillNotes: a.skill_notes ?? null,
            personalNotes: a.personal_notes ?? null,
          })),
        });
        return session.id;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = await this.prisma.attendanceSession.findFirst({
          where: {
            OR: [
              { clientGeneratedId: dto.client_generated_id },
              { extracurricularId: dto.extracurricular_id, sessionDate, coachId: coach.id },
            ],
          },
          select: { id: true },
        });
        throw alreadySynced(existing?.id ?? null);
      }
      throw e;
    }

    const summary = summarize(dto.attendances.map((a) => a.status));
    await this.audit.log({
      userId: actor.userId,
      action: 'SUBMIT_ATTENDANCE',
      entityType: 'attendance_session',
      entityId: sessionId,
      ipAddress: actor.ip,
      metadata: { extracurricularId: dto.extracurricular_id, sessionDate: dto.session_date, summary },
    });

    // Non-blocking: taruh job notifikasi ke queue (response submit tetap cepat).
    void this.notifications.enqueueAttendanceDone(sessionId);

    return {
      session_id: sessionId,
      status: 'SUBMITTED',
      synced_at: submittedAt.toISOString(),
      summary,
    };
  }

  // --- helpers ---

  private async getCoachOrThrow(userId: string) {
    const coach = await this.prisma.coach.findUnique({ where: { userId }, select: { id: true } });
    if (!coach) throw new ForbiddenException('Akun ini tidak memiliki profil pembina.');
    return coach;
  }

  private async assertCoachOwnsEkskul(coachId: string, extracurricularId: string) {
    const ekskul = await this.prisma.extracurricular.findUnique({
      where: { id: extracurricularId },
      select: { id: true, name: true, isActive: true, defaultCoachId: true },
    });
    if (!ekskul || !ekskul.isActive) throw new NotFoundException('Ekstrakurikuler tidak ditemukan.');
    if (ekskul.defaultCoachId !== coachId) {
      throw new ForbiddenException('Anda bukan pembina ekstrakurikuler ini.');
    }
    return ekskul;
  }
}

export function summarize(statuses: StatusCode[]) {
  const s = { total_students: statuses.length, hadir: 0, izin: 0, sakit: 0, alpa: 0 };
  for (const st of statuses) {
    if (st === 'HADIR') s.hadir++;
    else if (st === 'IZIN') s.izin++;
    else if (st === 'SAKIT') s.sakit++;
    else if (st === 'ALPA') s.alpa++;
  }
  return s;
}

function alreadySynced(existingSessionId: string | null) {
  return new ConflictException({
    error: 'SESSION_ALREADY_SYNCED',
    message: 'Sesi ini sudah pernah disinkronkan sebelumnya.',
    existing_session_id: existingSessionId,
  });
}

/** Tanggal "hari ini" di zona Asia/Jakarta sebagai "YYYY-MM-DD". */
function jakartaToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}

/** 1=Senin ... 7=Minggu untuk sebuah string "YYYY-MM-DD". */
export function isoDayOfWeek(dateStr: string): number {
  const d = new Date(`${dateStr}T00:00:00.000Z`).getUTCDay(); // 0=Minggu
  return d === 0 ? 7 : d;
}
