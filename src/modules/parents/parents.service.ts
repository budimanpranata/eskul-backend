import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { buildPageMeta, pageSkip, type PaginatedResult } from '../../common/dto/pagination.dto.js';
import type {
  ApproveRelationDto,
  ChildProgressQueryDto,
  LinkRequestDto,
} from './dto/parent.dto.js';

interface Actor {
  userId: string;
  ip: string | null;
}

type StatusCode = 'HADIR' | 'IZIN' | 'SAKIT' | 'ALPA';

/** Jeda pengajuan ulang setelah relasi ditolak (DoD Fase 2.4). */
const REJECT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
/** > ambang siswa berbeda per nomor HP dalam jendela waktu → tandai SUSPICIOUS. */
const SUSPICIOUS_MAX_STUDENTS = 5;
const SUSPICIOUS_WINDOW_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ParentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ================= ORANG TUA =================

  /** GET /parent/children — anak yang relasinya sudah APPROVED. */
  async children(userId: string) {
    const rels = await this.prisma.parentStudentRelation.findMany({
      where: { approvalStatus: 'APPROVED', parent: { userId } },
      include: {
        student: {
          select: { id: true, nis: true, fullName: true, classGrade: true, photoUrl: true },
        },
      },
      orderBy: { student: { fullName: 'asc' } },
    });
    return rels.map((r) => ({
      relationId: r.id,
      isPrimaryContact: r.isPrimaryContact,
      id: r.student.id,
      nis: r.student.nis,
      fullName: r.student.fullName,
      classGrade: r.student.classGrade,
      photoUrl: r.student.photoUrl,
    }));
  }

  /** POST /parent/link-request — ajukan relasi (status PENDING, tunggu admin). */
  async linkRequest(dto: LinkRequestDto, actor: Actor) {
    const parent = await this.getParentOrThrow(actor.userId);

    const student = await this.prisma.student.findUnique({
      where: { nis: dto.nis },
      select: { id: true, fullName: true, isActive: true },
    });
    if (!student || !student.isActive) {
      throw new NotFoundException('Siswa dengan NIS tersebut tidak ditemukan.');
    }

    // Verifikasi silang ringan: semua kata pada nama yang diinput harus ada di nama resmi.
    const tokens = dto.studentName.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const officialName = student.fullName.toLowerCase();
    if (!tokens.every((t) => officialName.includes(t))) {
      throw new BadRequestException('Nama siswa tidak cocok dengan NIS. Periksa kembali data.');
    }

    const existing = await this.prisma.parentStudentRelation.findUnique({
      where: { parentId_studentId: { parentId: parent.id, studentId: student.id } },
      select: { id: true, approvalStatus: true, approvedAt: true },
    });

    let relationId: string;
    if (existing) {
      if (existing.approvalStatus === 'APPROVED') {
        throw new ConflictException('Anda sudah terhubung dengan siswa ini.');
      }
      if (existing.approvalStatus === 'PENDING') {
        throw new ConflictException('Pengajuan untuk siswa ini masih menunggu persetujuan.');
      }
      // REJECTED → boleh ajukan ulang setelah jeda 24 jam sejak penolakan (DoD Fase 2.4).
      if (existing.approvedAt && Date.now() - existing.approvedAt.getTime() < REJECT_COOLDOWN_MS) {
        const hoursLeft = Math.ceil(
          (REJECT_COOLDOWN_MS - (Date.now() - existing.approvedAt.getTime())) / 3_600_000,
        );
        throw new ConflictException(
          `Pengajuan Anda sebelumnya ditolak. Coba lagi dalam ~${hoursLeft} jam.`,
        );
      }
      await this.prisma.parentStudentRelation.update({
        where: { id: existing.id },
        data: { approvalStatus: 'PENDING', approvedBy: null, approvedAt: null },
      });
      relationId = existing.id;
    } else {
      const created = await this.prisma.parentStudentRelation.create({
        data: { parentId: parent.id, studentId: student.id, approvalStatus: 'PENDING' },
        select: { id: true },
      });
      relationId = created.id;
    }

    await this.audit.log({
      userId: actor.userId,
      action: 'PARENT_LINK_REQUEST',
      entityType: 'parent_student_relation',
      entityId: relationId,
      ipAddress: actor.ip,
      metadata: { nis: dto.nis },
    });

    return {
      id: relationId,
      status: 'PENDING',
      message: 'Menunggu persetujuan admin sekolah.',
    };
  }

  /**
   * GET /parent/child-progress/:id — dashboard perkembangan anak (kontrak 4.2).
   * Wajib relasi APPROVED, jika tidak → 403 { error: 'UNAUTHORIZED_RELATION' }.
   */
  async childProgress(studentId: string, query: ChildProgressQueryDto, actor: Actor) {
    const relation = await this.prisma.parentStudentRelation.findFirst({
      where: { studentId, approvalStatus: 'APPROVED', parent: { userId: actor.userId } },
      select: { id: true },
    });
    if (!relation) {
      throw new ForbiddenException({
        error: 'UNAUTHORIZED_RELATION',
        message: 'Anda belum terverifikasi sebagai wali sah dari siswa ini.',
      });
    }

    const student = await this.prisma.student.findUniqueOrThrow({
      where: { id: studentId },
      select: { id: true, fullName: true, classGrade: true, photoUrl: true },
    });

    const to = query.to ?? jakartaToday();
    const from = query.from ?? shiftDays(to, query.period === 'monthly' ? -180 : -90);
    const fromDate = new Date(`${from}T00:00:00.000Z`);
    const toDate = new Date(`${to}T00:00:00.000Z`);

    const memberships = await this.prisma.extracurricularMember.findMany({
      where: {
        studentId,
        ...(query.extracurricularId ? { extracurricularId: query.extracurricularId } : {}),
      },
      include: { extracurricular: { select: { id: true, name: true } } },
      orderBy: { extracurricular: { name: 'asc' } },
    });
    const ekskulIds = memberships.map((m) => m.extracurricularId);

    // Satu query untuk SEMUA ekskul anak (hindari N+1 — Fase 4.4), lalu group di memori.
    const allDetails = ekskulIds.length
      ? await this.prisma.attendanceDetail.findMany({
          where: {
            studentId,
            session: {
              extracurricularId: { in: ekskulIds },
              status: { in: ['SUBMITTED', 'SYNCED'] },
              sessionDate: { gte: fromDate, lte: toDate },
            },
          },
          include: {
            session: {
              select: {
                extracurricularId: true,
                sessionDate: true,
                materialDescription: true,
                coach: { select: { user: { select: { fullName: true } } } },
              },
            },
          },
          orderBy: { session: { sessionDate: 'asc' } },
        })
      : [];

    const detailsByEkskul = new Map<string, typeof allDetails>();
    for (const d of allDetails) {
      const list = detailsByEkskul.get(d.session.extracurricularId) ?? [];
      list.push(d);
      detailsByEkskul.set(d.session.extracurricularId, list);
    }

    const extracurriculars = memberships.map((m) => {
      const details = detailsByEkskul.get(m.extracurricularId) ?? [];

      const counts = { hadir: 0, izin: 0, sakit: 0, alpa: 0 };
      for (const d of details) counts[statusKey(d.status as StatusCode)] += 1;
      const total = details.length;

      // Tren keaktifan diagregasi per minggu / bulan sesuai toggle `period` (Fase 3.2).
      const activenessTrend = bucketActivenessTrend(
        details.map((d) => ({ sessionDate: d.session.sessionDate, status: d.status, score: d.activenessScore })),
        query.period,
      );

      const materialsTimeline = details
        .filter((d) => d.session.materialDescription)
        .slice()
        .reverse()
        .slice(0, 20)
        .map((d) => ({
          date: fmtDate(d.session.sessionDate),
          description: d.session.materialDescription,
          coach_name: d.session.coach.user.fullName,
          coach_feedback: d.skillNotes ?? null,
        }));

      return {
        id: m.extracurricular.id,
        name: m.extracurricular.name,
        attendance_summary: {
          total_sessions: total,
          hadir: counts.hadir,
          izin: counts.izin,
          sakit: counts.sakit,
          alpa: counts.alpa,
          percentage: total ? Math.round((counts.hadir / total) * 1000) / 10 : 0,
        },
        activeness_trend: activenessTrend,
        materials_timeline: materialsTimeline,
      };
    });

    const notif = await this.prisma.notification.findFirst({
      where: { userId: actor.userId },
      orderBy: { sentAt: 'desc' },
      select: { type: true, sentAt: true },
    });

    await this.audit.log({
      userId: actor.userId,
      action: 'VIEW_STUDENT_DATA',
      entityType: 'student',
      entityId: studentId,
      ipAddress: actor.ip,
      metadata: { via: 'child-progress', period: query.period, from, to },
    });

    return {
      student: {
        id: student.id,
        full_name: student.fullName,
        class_grade: student.classGrade,
        photo_url: student.photoUrl,
      },
      period: { period: query.period, from, to },
      extracurriculars,
      latest_notification: notif ? { type: notif.type, sent_at: notif.sentAt } : null,
    };
  }

  // ================= ADMIN =================

  async listRelations(
    status: string,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<unknown>> {
    const where: Prisma.ParentStudentRelationWhereInput = {};
    if (['PENDING', 'APPROVED', 'REJECTED'].includes(status)) where.approvalStatus = status;

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.parentStudentRelation.count({ where }),
      this.prisma.parentStudentRelation.findMany({
        where,
        include: {
          parent: {
            include: {
              user: { select: { fullName: true, email: true, phoneNumber: true } },
            },
          },
          student: { select: { id: true, nis: true, fullName: true, classGrade: true } },
        },
        orderBy: { createdAt: 'asc' },
        skip: pageSkip(page, pageSize),
        take: pageSize,
      }),
    ]);

    // Deteksi kecurigaan: satu nomor HP mengajukan relasi ke > 5 siswa berbeda / 24 jam.
    const phones = [
      ...new Set(rows.map((r) => r.parent.user.phoneNumber).filter((p): p is string => !!p)),
    ];
    const since = new Date(Date.now() - SUSPICIOUS_WINDOW_MS);
    const suspiciousPhones = new Set<string>();
    for (const phone of phones) {
      const recent = await this.prisma.parentStudentRelation.findMany({
        where: { createdAt: { gte: since }, parent: { user: { phoneNumber: phone } } },
        select: { studentId: true },
        distinct: ['studentId'],
      });
      if (recent.length > SUSPICIOUS_MAX_STUDENTS) suspiciousPhones.add(phone);
    }

    const data = rows.map((r) => ({
      id: r.id,
      approvalStatus: r.approvalStatus,
      createdAt: r.createdAt,
      approvedAt: r.approvedAt,
      suspicious: !!r.parent.user.phoneNumber && suspiciousPhones.has(r.parent.user.phoneNumber),
      parent: {
        relationType: r.parent.relationType,
        fullName: r.parent.user.fullName,
        email: r.parent.user.email,
        phoneNumber: r.parent.user.phoneNumber,
      },
      student: r.student,
    }));
    return { data, meta: buildPageMeta(page, pageSize, total) };
  }

  async decideRelation(relationId: string, dto: ApproveRelationDto, actor: Actor) {
    const rel = await this.prisma.parentStudentRelation.findUnique({
      where: { id: relationId },
      select: { id: true, approvalStatus: true },
    });
    if (!rel) throw new NotFoundException('Relasi tidak ditemukan.');
    if (rel.approvalStatus !== 'PENDING') {
      throw new ConflictException(`Relasi ini sudah berstatus ${rel.approvalStatus}.`);
    }

    const updated = await this.prisma.parentStudentRelation.update({
      where: { id: relationId },
      data: {
        approvalStatus: dto.decision,
        approvedBy: actor.userId,
        approvedAt: new Date(),
      },
      include: {
        student: { select: { id: true, fullName: true } },
        parent: { select: { userId: true } },
      },
    });

    await this.audit.log({
      userId: actor.userId,
      action: dto.decision === 'APPROVED' ? 'APPROVE_PARENT_RELATION' : 'REJECT_PARENT_RELATION',
      entityType: 'parent_student_relation',
      entityId: relationId,
      ipAddress: actor.ip,
      metadata: { reason: dto.reason ?? null, studentId: updated.student.id },
    });

    // Notifikasi push ke orang tua (via job queue Fase 1.5) — non-blocking & idempoten.
    const approved = dto.decision === 'APPROVED';
    void this.notifications.enqueueUserNotification({
      userId: updated.parent.userId,
      type: 'RELATION_DECISION',
      title: approved ? 'Permintaan hubungan disetujui' : 'Permintaan hubungan ditolak',
      body: approved
        ? `Akun Anda kini terhubung dengan ${updated.student.fullName}.`
        : `Permintaan hubungan dengan ${updated.student.fullName} ditolak.` +
          (dto.reason ? ` Alasan: ${dto.reason}` : ''),
      payload: { relationId, decision: dto.decision, studentId: updated.student.id },
      jobId: `notify_rel_${relationId}_${dto.decision}`,
      dedupeKey: `rel:${relationId}:${dto.decision}`,
    });

    return {
      id: updated.id,
      approvalStatus: updated.approvalStatus,
      approvedAt: updated.approvedAt,
    };
  }

  // --- helpers ---

  private async getParentOrThrow(userId: string) {
    const parent = await this.prisma.parent.findUnique({ where: { userId }, select: { id: true } });
    if (!parent) throw new ForbiddenException('Akun ini bukan akun Orang Tua.');
    return parent;
  }
}

function statusKey(s: StatusCode): 'hadir' | 'izin' | 'sakit' | 'alpa' {
  return s.toLowerCase() as 'hadir' | 'izin' | 'sakit' | 'alpa';
}

function jakartaToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const ID_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** Senin (UTC) dari minggu yang memuat `d`. */
function mondayOfWeekUTC(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = x.getUTCDay(); // 0=Minggu
  x.setUTCDate(x.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return x;
}

/**
 * Agregasi skor keaktifan (hanya baris HADIR ber-skor) menjadi titik tren per
 * minggu atau per bulan, terurut kronologis. Aman untuk data minim (1 titik pun
 * tetap menghasilkan 1 entri — DoD Fase 3.2).
 */
export function bucketActivenessTrend(
  rows: { sessionDate: Date; status: string; score: number | null }[],
  period: 'weekly' | 'monthly',
): { bucket: string; label: string; avg_score: number; sessions: number }[] {
  const buckets = new Map<string, { label: string; order: number; sum: number; n: number }>();
  for (const r of rows) {
    if (r.status !== 'HADIR' || r.score == null) continue;
    const d = r.sessionDate;
    let key: string;
    let label: string;
    let order: number;
    if (period === 'monthly') {
      key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      label = `${ID_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
      order = d.getUTCFullYear() * 12 + d.getUTCMonth();
    } else {
      const mon = mondayOfWeekUTC(d);
      key = fmtDate(mon);
      label = `${mon.getUTCDate()} ${ID_MONTHS[mon.getUTCMonth()]}`;
      order = mon.getTime();
    }
    const b = buckets.get(key) ?? { label, order, sum: 0, n: 0 };
    b.sum += r.score;
    b.n += 1;
    buckets.set(key, b);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[1].order - b[1].order)
    .map(([bucket, b]) => ({
      bucket,
      label: b.label,
      avg_score: Math.round((b.sum / b.n) * 10) / 10,
      sessions: b.n,
    }));
}

export function shiftDays(dateStr: string, deltaDays: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}
