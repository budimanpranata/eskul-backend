import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';

import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { buildPageMeta, pageSkip, type PaginatedResult } from '../../common/dto/pagination.dto.js';
import { definedKeys } from '../../common/util/defined-keys.js';
import type { CreateCoachDto } from './dto/create-coach.dto.js';
import type { ListCoachesQueryDto } from './dto/list-coaches-query.dto.js';
import type { UpdateCoachDto } from './dto/update-coach.dto.js';

interface Actor {
  id: string;
  ip: string | null;
  /** Hasil `tenantScope(user)` — `undefined` = ADMIN_SUPER (lintas sekolah). */
  schoolId: string | undefined;
}

const COACH_INCLUDE = {
  user: {
    select: {
      id: true,
      fullName: true,
      email: true,
      phoneNumber: true,
      isActive: true,
      lastLoginAt: true,
    },
  },
} satisfies Prisma.CoachInclude;

@Injectable()
export class CoachesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListCoachesQueryDto, schoolScope: string | undefined): Promise<PaginatedResult<unknown>> {
    const where: Prisma.CoachWhereInput = {};
    if (query.search) {
      where.OR = [
        { employeeNumber: { contains: query.search, mode: 'insensitive' } },
        { user: { fullName: { contains: query.search, mode: 'insensitive' } } },
        { user: { email: { contains: query.search, mode: 'insensitive' } } },
      ];
    }
    const userWhere: Prisma.UserWhereInput = {};
    if (query.isActive === 'true' || query.isActive === 'false') {
      userWhere.isActive = query.isActive === 'true';
    }
    if (schoolScope !== undefined) userWhere.schoolId = schoolScope;
    if (Object.keys(userWhere).length > 0) where.user = userWhere;

    const [total, data] = await this.prisma.$transaction([
      this.prisma.coach.count({ where }),
      this.prisma.coach.findMany({
        where,
        include: COACH_INCLUDE,
        orderBy: { user: { fullName: 'asc' } },
        skip: pageSkip(query.page, query.pageSize),
        take: query.pageSize,
      }),
    ]);
    return { data, meta: buildPageMeta(query.page, query.pageSize, total) };
  }

  async getById(id: string, schoolScope: string | undefined) {
    const coach = await this.prisma.coach.findFirst({
      where: { id, ...(schoolScope !== undefined ? { user: { schoolId: schoolScope } } : {}) },
      include: COACH_INCLUDE,
    });
    if (!coach) throw new NotFoundException('Pembina tidak ditemukan.');
    return coach;
  }

  /** Membuat akun users (role PEMBINA) + profil coaches dalam satu transaksi. */
  async create(dto: CreateCoachDto, actor: Actor) {
    if (!actor.schoolId) {
      throw new ConflictException('Operasi ini memerlukan konteks ADMIN sekolah (bukan ADMIN_SUPER).');
    }
    await this.assertUserFieldsAvailable(dto.email, dto.phoneNumber);
    if (dto.employeeNumber) await this.assertEmployeeNumberAvailable(dto.employeeNumber);

    const pembinaRole = await this.prisma.role.findUniqueOrThrow({ where: { code: 'PEMBINA' } });
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });

    const coach = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          roleId: pembinaRole.id,
          schoolId: actor.schoolId,
          fullName: dto.fullName,
          email: dto.email,
          phoneNumber: dto.phoneNumber ?? null,
          passwordHash,
        },
      });
      return tx.coach.create({
        data: {
          userId: user.id,
          employeeNumber: dto.employeeNumber ?? null,
          specialization: dto.specialization ?? null,
          bio: dto.bio ?? null,
        },
        include: COACH_INCLUDE,
      });
    });

    await this.audit.log({
      userId: actor.id,
      action: 'CREATE_COACH',
      entityType: 'coach',
      entityId: coach.id,
      ipAddress: actor.ip,
      metadata: { userId: coach.userId, email: dto.email },
    });
    return coach;
  }

  async update(id: string, dto: UpdateCoachDto, actor: Actor) {
    const coach = await this.getById(id, actor.schoolId);
    if (dto.email || dto.phoneNumber) {
      await this.assertUserFieldsAvailable(dto.email, dto.phoneNumber, coach.userId);
    }
    if (dto.employeeNumber) await this.assertEmployeeNumberAvailable(dto.employeeNumber, id);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.fullName || dto.email || dto.phoneNumber !== undefined) {
        await tx.user.update({
          where: { id: coach.userId },
          data: {
            fullName: dto.fullName,
            email: dto.email,
            phoneNumber: dto.phoneNumber,
          },
        });
      }
      return tx.coach.update({
        where: { id },
        data: {
          employeeNumber: dto.employeeNumber,
          specialization: dto.specialization,
          bio: dto.bio,
        },
        include: COACH_INCLUDE,
      });
    });

    await this.audit.log({
      userId: actor.id,
      action: 'UPDATE_COACH',
      entityType: 'coach',
      entityId: id,
      ipAddress: actor.ip,
      metadata: { fields: definedKeys(dto as Record<string, unknown>) },
    });
    return updated;
  }

  /**
   * Soft-delete: nonaktifkan akun users terkait (tabel coaches tak punya kolom
   * is_active). Baris coach & data presensi historis tetap utuh. Refresh token
   * pembina otomatis gagal di endpoint /auth/refresh karena user tidak aktif.
   */
  async deactivate(id: string, actor: Actor) {
    const coach = await this.getById(id, actor.schoolId);
    await this.prisma.user.update({ where: { id: coach.userId }, data: { isActive: false } });
    await this.audit.log({
      userId: actor.id,
      action: 'DEACTIVATE_COACH',
      entityType: 'coach',
      entityId: id,
      ipAddress: actor.ip,
      metadata: { userId: coach.userId },
    });
    return this.getById(id, actor.schoolId);
  }

  async reactivate(id: string, actor: Actor) {
    const coach = await this.getById(id, actor.schoolId);
    await this.prisma.user.update({ where: { id: coach.userId }, data: { isActive: true } });
    await this.audit.log({
      userId: actor.id,
      action: 'REACTIVATE_COACH',
      entityType: 'coach',
      entityId: id,
      ipAddress: actor.ip,
      metadata: { userId: coach.userId },
    });
    return this.getById(id, actor.schoolId);
  }

  // --- helpers ---

  private async assertUserFieldsAvailable(email?: string, phone?: string, exceptUserId?: string) {
    const or: Prisma.UserWhereInput[] = [];
    if (email) or.push({ email });
    if (phone) or.push({ phoneNumber: phone });
    if (or.length === 0) return;
    const clash = await this.prisma.user.findFirst({ where: { OR: or }, select: { id: true, email: true } });
    if (clash && clash.id !== exceptUserId) {
      throw new ConflictException('Email atau nomor HP sudah dipakai akun lain.');
    }
  }

  private async assertEmployeeNumberAvailable(employeeNumber: string, exceptCoachId?: string) {
    const clash = await this.prisma.coach.findUnique({
      where: { employeeNumber },
      select: { id: true },
    });
    if (clash && clash.id !== exceptCoachId) {
      throw new ConflictException(`Nomor pegawai ${employeeNumber} sudah dipakai.`);
    }
  }
}
