import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { buildPageMeta, pageSkip, type PaginatedResult } from '../../common/dto/pagination.dto.js';
import {
  formatTimeOfDay,
  minutesOfDay,
  parseTimeOfDay,
} from '../../common/util/time-of-day.js';
import { definedKeys } from '../../common/util/defined-keys.js';
import type {
  AddMembersDto,
  CreateExtracurricularDto,
  CreateScheduleDto,
  ListExtracurricularsQueryDto,
  UpdateExtracurricularDto,
  UpdateScheduleDto,
} from './dto/extracurricular.dto.js';

interface Actor {
  id: string;
  ip: string | null;
}

const DAY_LABELS = ['', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];

@Injectable()
export class ExtracurricularsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ============ EKSKUL ============

  async list(query: ListExtracurricularsQueryDto): Promise<PaginatedResult<unknown>> {
    const where: Prisma.ExtracurricularWhereInput = {};
    if (query.search) where.name = { contains: query.search, mode: 'insensitive' };
    if (query.category) where.category = query.category;
    if (query.isActive === 'true') where.isActive = true;
    if (query.isActive === 'false') where.isActive = false;

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.extracurricular.count({ where }),
      this.prisma.extracurricular.findMany({
        where,
        include: {
          defaultCoach: { include: { user: { select: { fullName: true } } } },
          _count: { select: { members: true, schedules: true } },
        },
        orderBy: { name: 'asc' },
        skip: pageSkip(query.page, query.pageSize),
        take: query.pageSize,
      }),
    ]);

    const data = rows.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      description: r.description,
      defaultCoachId: r.defaultCoachId,
      defaultCoachName: r.defaultCoach?.user.fullName ?? null,
      maxCapacity: r.maxCapacity,
      isActive: r.isActive,
      memberCount: r._count.members,
      scheduleCount: r._count.schedules,
      createdAt: r.createdAt,
    }));
    return { data, meta: buildPageMeta(query.page, query.pageSize, total) };
  }

  async getById(id: string) {
    const row = await this.prisma.extracurricular.findUnique({
      where: { id },
      include: {
        defaultCoach: { include: { user: { select: { fullName: true } } } },
        schedules: { orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }] },
        _count: { select: { members: true } },
      },
    });
    if (!row) throw new NotFoundException('Ekstrakurikuler tidak ditemukan.');
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      description: row.description,
      defaultCoachId: row.defaultCoachId,
      defaultCoachName: row.defaultCoach?.user.fullName ?? null,
      maxCapacity: row.maxCapacity,
      isActive: row.isActive,
      memberCount: row._count.members,
      schedules: row.schedules.map((s) => ({
        id: s.id,
        dayOfWeek: s.dayOfWeek,
        dayLabel: DAY_LABELS[s.dayOfWeek],
        startTime: formatTimeOfDay(s.startTime),
        endTime: formatTimeOfDay(s.endTime),
        location: s.location,
        isActive: s.isActive,
      })),
      createdAt: row.createdAt,
    };
  }

  async create(dto: CreateExtracurricularDto, actor: Actor) {
    if (dto.defaultCoachId) await this.assertCoachExists(dto.defaultCoachId);
    const row = await this.prisma.extracurricular.create({
      data: {
        name: dto.name,
        category: dto.category ?? null,
        description: dto.description ?? null,
        defaultCoachId: dto.defaultCoachId ?? null,
        maxCapacity: dto.maxCapacity ?? null,
      },
    });
    await this.audit.log({
      userId: actor.id,
      action: 'CREATE_EXTRACURRICULAR',
      entityType: 'extracurricular',
      entityId: row.id,
      ipAddress: actor.ip,
      metadata: { name: row.name },
    });
    return this.getById(row.id);
  }

  async update(id: string, dto: UpdateExtracurricularDto, actor: Actor) {
    await this.getRawOrThrow(id);
    if (dto.defaultCoachId) await this.assertCoachExists(dto.defaultCoachId);
    await this.prisma.extracurricular.update({
      where: { id },
      data: {
        name: dto.name,
        category: dto.category,
        description: dto.description,
        defaultCoachId: dto.defaultCoachId,
        maxCapacity: dto.maxCapacity,
      },
    });
    await this.audit.log({
      userId: actor.id,
      action: 'UPDATE_EXTRACURRICULAR',
      entityType: 'extracurricular',
      entityId: id,
      ipAddress: actor.ip,
      metadata: { fields: definedKeys(dto as Record<string, unknown>) },
    });
    return this.getById(id);
  }

  async deactivate(id: string, actor: Actor) {
    await this.getRawOrThrow(id);
    await this.prisma.extracurricular.update({ where: { id }, data: { isActive: false } });
    await this.audit.log({
      userId: actor.id,
      action: 'DEACTIVATE_EXTRACURRICULAR',
      entityType: 'extracurricular',
      entityId: id,
      ipAddress: actor.ip,
    });
    return this.getById(id);
  }

  async reactivate(id: string, actor: Actor) {
    await this.getRawOrThrow(id);
    await this.prisma.extracurricular.update({ where: { id }, data: { isActive: true } });
    await this.audit.log({
      userId: actor.id,
      action: 'REACTIVATE_EXTRACURRICULAR',
      entityType: 'extracurricular',
      entityId: id,
      ipAddress: actor.ip,
    });
    return this.getById(id);
  }

  // ============ JADWAL ============

  async addSchedule(ekskulId: string, dto: CreateScheduleDto, actor: Actor) {
    await this.getRawOrThrow(ekskulId);
    this.assertTimeOrder(dto.startTime, dto.endTime);
    await this.assertNoScheduleClash(dto.dayOfWeek, dto.startTime, dto.endTime, dto.location ?? null);

    const schedule = await this.prisma.extracurricularSchedule.create({
      data: {
        extracurricularId: ekskulId,
        dayOfWeek: dto.dayOfWeek,
        startTime: parseTimeOfDay(dto.startTime),
        endTime: parseTimeOfDay(dto.endTime),
        location: dto.location ?? null,
      },
    });
    await this.audit.log({
      userId: actor.id,
      action: 'CREATE_SCHEDULE',
      entityType: 'extracurricular_schedule',
      entityId: schedule.id,
      ipAddress: actor.ip,
      metadata: { extracurricularId: ekskulId, dayOfWeek: dto.dayOfWeek },
    });
    return this.getById(ekskulId);
  }

  async updateSchedule(
    ekskulId: string,
    scheduleId: string,
    dto: UpdateScheduleDto,
    actor: Actor,
  ) {
    const current = await this.prisma.extracurricularSchedule.findFirst({
      where: { id: scheduleId, extracurricularId: ekskulId },
    });
    if (!current) throw new NotFoundException('Jadwal tidak ditemukan pada ekskul ini.');

    const dayOfWeek = dto.dayOfWeek ?? current.dayOfWeek;
    const startTime = dto.startTime ?? formatTimeOfDay(current.startTime);
    const endTime = dto.endTime ?? formatTimeOfDay(current.endTime);
    const location = dto.location !== undefined ? dto.location : current.location;

    this.assertTimeOrder(startTime, endTime);
    await this.assertNoScheduleClash(dayOfWeek, startTime, endTime, location, scheduleId);

    await this.prisma.extracurricularSchedule.update({
      where: { id: scheduleId },
      data: {
        dayOfWeek,
        startTime: parseTimeOfDay(startTime),
        endTime: parseTimeOfDay(endTime),
        location,
      },
    });
    await this.audit.log({
      userId: actor.id,
      action: 'UPDATE_SCHEDULE',
      entityType: 'extracurricular_schedule',
      entityId: scheduleId,
      ipAddress: actor.ip,
    });
    return this.getById(ekskulId);
  }

  async removeSchedule(ekskulId: string, scheduleId: string, actor: Actor) {
    const current = await this.prisma.extracurricularSchedule.findFirst({
      where: { id: scheduleId, extracurricularId: ekskulId },
    });
    if (!current) throw new NotFoundException('Jadwal tidak ditemukan pada ekskul ini.');

    // Soft-delete: attendance_sessions.schedule_id (nullable, NO ACTION) mungkin
    // masih menunjuk baris ini. Nonaktifkan agar histori presensi tetap konsisten.
    await this.prisma.extracurricularSchedule.update({
      where: { id: scheduleId },
      data: { isActive: false },
    });
    await this.audit.log({
      userId: actor.id,
      action: 'DEACTIVATE_SCHEDULE',
      entityType: 'extracurricular_schedule',
      entityId: scheduleId,
      ipAddress: actor.ip,
    });
    return this.getById(ekskulId);
  }

  // ============ ANGGOTA ============

  async listMembers(
    ekskulId: string,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<unknown>> {
    await this.getRawOrThrow(ekskulId);
    const where: Prisma.ExtracurricularMemberWhereInput = { extracurricularId: ekskulId };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.extracurricularMember.count({ where }),
      this.prisma.extracurricularMember.findMany({
        where,
        include: {
          student: {
            select: { id: true, nis: true, fullName: true, classGrade: true, isActive: true },
          },
        },
        orderBy: { student: { fullName: 'asc' } },
        skip: pageSkip(page, pageSize),
        take: pageSize,
      }),
    ]);
    const data = rows.map((m) => ({
      membershipId: m.id,
      status: m.status,
      joinedDate: m.joinedDate,
      student: m.student,
    }));
    return { data, meta: buildPageMeta(page, pageSize, total) };
  }

  async addMembers(ekskulId: string, dto: AddMembersDto, actor: Actor) {
    const ekskul = await this.getRawOrThrow(ekskulId);
    const ids = [...new Set(dto.studentIds)];
    if (ids.length === 0) throw new BadRequestException('Tidak ada siswa yang dipilih.');

    const students = await this.prisma.student.findMany({
      where: { id: { in: ids } },
      select: { id: true, isActive: true },
    });
    const foundIds = new Set(students.map((s) => s.id));
    const missing = ids.filter((id) => !foundIds.has(id));
    if (missing.length) {
      throw new BadRequestException(`Siswa tidak ditemukan: ${missing.join(', ')}`);
    }
    const inactive = students.filter((s) => !s.isActive).map((s) => s.id);
    if (inactive.length) {
      throw new BadRequestException(`Siswa nonaktif tidak bisa didaftarkan: ${inactive.join(', ')}`);
    }

    const already = await this.prisma.extracurricularMember.findMany({
      where: { extracurricularId: ekskulId, studentId: { in: ids } },
      select: { studentId: true },
    });
    const alreadySet = new Set(already.map((a) => a.studentId));
    const toAdd = ids.filter((id) => !alreadySet.has(id));

    if (ekskul.maxCapacity != null) {
      const currentCount = await this.prisma.extracurricularMember.count({
        where: { extracurricularId: ekskulId },
      });
      if (currentCount + toAdd.length > ekskul.maxCapacity) {
        throw new ConflictException(
          `Kapasitas ekskul (${ekskul.maxCapacity}) terlampaui. ` +
            `Anggota saat ini ${currentCount}, ingin menambah ${toAdd.length}.`,
        );
      }
    }

    let added = 0;
    if (toAdd.length) {
      const res = await this.prisma.extracurricularMember.createMany({
        data: toAdd.map((studentId) => ({ extracurricularId: ekskulId, studentId })),
        skipDuplicates: true,
      });
      added = res.count;
    }

    await this.audit.log({
      userId: actor.id,
      action: 'ENROLL_MEMBERS',
      entityType: 'extracurricular_member',
      entityId: ekskulId,
      ipAddress: actor.ip,
      metadata: { added, skippedExisting: alreadySet.size, requested: ids.length },
    });
    return { added, skippedExisting: alreadySet.size };
  }

  async removeMember(ekskulId: string, studentId: string, actor: Actor) {
    const member = await this.prisma.extracurricularMember.findUnique({
      where: { extracurricularId_studentId: { extracurricularId: ekskulId, studentId } },
      select: { id: true },
    });
    if (!member) throw new NotFoundException('Siswa ini bukan anggota ekskul tersebut.');

    await this.prisma.extracurricularMember.delete({ where: { id: member.id } });
    await this.audit.log({
      userId: actor.id,
      action: 'UNENROLL_MEMBER',
      entityType: 'extracurricular_member',
      entityId: member.id,
      ipAddress: actor.ip,
      metadata: { extracurricularId: ekskulId, studentId },
    });
    return { removed: true };
  }

  // --- helpers ---

  private async getRawOrThrow(id: string) {
    const row = await this.prisma.extracurricular.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Ekstrakurikuler tidak ditemukan.');
    return row;
  }

  private async assertCoachExists(coachId: string) {
    const coach = await this.prisma.coach.findUnique({ where: { id: coachId }, select: { id: true } });
    if (!coach) throw new BadRequestException('Pembina default tidak ditemukan.');
  }

  private assertTimeOrder(start: string, end: string) {
    if (minutesOfDay(end) <= minutesOfDay(start)) {
      throw new BadRequestException('Jam selesai harus setelah jam mulai.');
    }
  }

  /**
   * DoD: cegah jadwal bentrok jam di LOKASI yang sama (lintas semua ekskul).
   * Bandingkan hanya jadwal aktif, hari yang sama, lokasi persis sama (non-null).
   */
  private async assertNoScheduleClash(
    dayOfWeek: number,
    start: string,
    end: string,
    location: string | null,
    exceptScheduleId?: string,
  ) {
    if (!location) return; // tanpa lokasi tidak ada konsep "bentrok tempat"
    const sameSlot = await this.prisma.extracurricularSchedule.findMany({
      where: {
        isActive: true,
        dayOfWeek,
        location,
        id: exceptScheduleId ? { not: exceptScheduleId } : undefined,
      },
      include: { extracurricular: { select: { name: true } } },
    });

    const s = minutesOfDay(start);
    const e = minutesOfDay(end);
    for (const other of sameSlot) {
      const os = other.startTime.getUTCHours() * 60 + other.startTime.getUTCMinutes();
      const oe = other.endTime.getUTCHours() * 60 + other.endTime.getUTCMinutes();
      if (s < oe && e > os) {
        throw new ConflictException(
          `Bentrok jadwal di "${location}" (${DAY_LABELS[dayOfWeek]}) dengan ekskul ` +
            `"${other.extracurricular.name}" ${formatTimeOfDay(other.startTime)}-${formatTimeOfDay(other.endTime)}.`,
        );
      }
    }
  }
}
