import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';

import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { buildPageMeta, pageSkip, type PaginatedResult } from '../../common/dto/pagination.dto.js';
import { definedKeys } from '../../common/util/defined-keys.js';
import type { CreateSchoolAdminDto, CreateSchoolDto, ListSchoolsQueryDto, UpdateSchoolDto } from './dto/school.dto.js';

interface Actor {
  id: string;
  ip: string | null;
}

const SCHOOL_SELECT = {
  id: true,
  code: true,
  name: true,
  isActive: true,
  createdAt: true,
  _count: { select: { users: true, students: true, extracurriculars: true } },
} satisfies Prisma.SchoolSelect;

/**
 * Pendaftaran & pengelolaan sekolah (tenant) — khusus ADMIN_SUPER.
 * Strategi A (shared DB + `school_id`) dari MULTI-TENANT.md §2: satu baris
 * `schools` + admin pertamanya dibuat di sini; isolasi data ditegakkan di
 * setiap modul lain lewat `tenantScope(user)`.
 */
@Injectable()
export class SchoolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListSchoolsQueryDto): Promise<PaginatedResult<unknown>> {
    const where: Prisma.SchoolWhereInput = {};
    if (query.search) {
      where.OR = [
        { code: { contains: query.search, mode: 'insensitive' } },
        { name: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.isActive === 'true') where.isActive = true;
    if (query.isActive === 'false') where.isActive = false;

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.school.count({ where }),
      this.prisma.school.findMany({
        where,
        select: SCHOOL_SELECT,
        orderBy: { name: 'asc' },
        skip: pageSkip(query.page, query.pageSize),
        take: query.pageSize,
      }),
    ]);
    return { data: rows.map(presentSchool), meta: buildPageMeta(query.page, query.pageSize, total) };
  }

  async getById(id: string) {
    const row = await this.prisma.school.findUnique({ where: { id }, select: SCHOOL_SELECT });
    if (!row) throw new NotFoundException('Sekolah tidak ditemukan.');
    return presentSchool(row);
  }

  /** Membuat sekolah + akun ADMIN pertamanya dalam satu transaksi. */
  async create(dto: CreateSchoolDto, actor: Actor) {
    const codeClash = await this.prisma.school.findUnique({ where: { code: dto.code }, select: { id: true } });
    if (codeClash) throw new ConflictException(`Kode sekolah "${dto.code}" sudah dipakai.`);
    await this.assertAdminFieldsAvailable(dto.adminEmail, dto.adminPhoneNumber);

    const adminRole = await this.prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN' } });
    const passwordHash = await argon2.hash(dto.adminPassword, { type: argon2.argon2id });

    const school = await this.prisma.$transaction(async (tx) => {
      const createdSchool = await tx.school.create({
        data: { code: dto.code, name: dto.name },
      });
      await tx.user.create({
        data: {
          roleId: adminRole.id,
          schoolId: createdSchool.id,
          fullName: dto.adminFullName,
          email: dto.adminEmail,
          phoneNumber: dto.adminPhoneNumber ?? null,
          passwordHash,
        },
      });
      return createdSchool;
    });

    await this.audit.log({
      userId: actor.id,
      action: 'CREATE_SCHOOL',
      entityType: 'school',
      entityId: school.id,
      ipAddress: actor.ip,
      metadata: { code: school.code, name: school.name, adminEmail: dto.adminEmail },
    });
    return this.getById(school.id);
  }

  async update(id: string, dto: UpdateSchoolDto, actor: Actor) {
    await this.getRawOrThrow(id);
    await this.prisma.school.update({ where: { id }, data: { name: dto.name } });
    await this.audit.log({
      userId: actor.id,
      action: 'UPDATE_SCHOOL',
      entityType: 'school',
      entityId: id,
      ipAddress: actor.ip,
      metadata: { fields: definedKeys(dto as Record<string, unknown>) },
    });
    return this.getById(id);
  }

  /** Sekolah nonaktif → login ADMIN/PEMBINA sekolah ini ditolak (lihat AuthService.login). */
  async suspend(id: string, actor: Actor) {
    await this.getRawOrThrow(id);
    await this.prisma.school.update({ where: { id }, data: { isActive: false } });
    await this.audit.log({
      userId: actor.id,
      action: 'SUSPEND_SCHOOL',
      entityType: 'school',
      entityId: id,
      ipAddress: actor.ip,
    });
    return this.getById(id);
  }

  async resume(id: string, actor: Actor) {
    await this.getRawOrThrow(id);
    await this.prisma.school.update({ where: { id }, data: { isActive: true } });
    await this.audit.log({
      userId: actor.id,
      action: 'RESUME_SCHOOL',
      entityType: 'school',
      entityId: id,
      ipAddress: actor.ip,
    });
    return this.getById(id);
  }

  /** Tambah admin lain ke sekolah yang sudah ada. */
  async addAdmin(schoolId: string, dto: CreateSchoolAdminDto, actor: Actor) {
    const school = await this.getRawOrThrow(schoolId);
    await this.assertAdminFieldsAvailable(dto.email, dto.phoneNumber);

    const adminRole = await this.prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN' } });
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });

    const user = await this.prisma.user.create({
      data: {
        roleId: adminRole.id,
        schoolId: school.id,
        fullName: dto.fullName,
        email: dto.email,
        phoneNumber: dto.phoneNumber ?? null,
        passwordHash,
      },
      select: { id: true, fullName: true, email: true },
    });

    await this.audit.log({
      userId: actor.id,
      action: 'CREATE_SCHOOL_ADMIN',
      entityType: 'user',
      entityId: user.id,
      ipAddress: actor.ip,
      metadata: { schoolId, email: user.email },
    });
    return user;
  }

  // --- helpers ---

  private async getRawOrThrow(id: string) {
    const row = await this.prisma.school.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Sekolah tidak ditemukan.');
    return row;
  }

  private async assertAdminFieldsAvailable(email: string, phone?: string) {
    const or: Prisma.UserWhereInput[] = [{ email }];
    if (phone) or.push({ phoneNumber: phone });
    const clash = await this.prisma.user.findFirst({ where: { OR: or }, select: { id: true } });
    if (clash) throw new ConflictException('Email atau nomor HP sudah dipakai akun lain.');
  }
}

function presentSchool(row: {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  _count: { users: number; students: number; extracurriculars: number };
}) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    isActive: row.isActive,
    createdAt: row.createdAt,
    userCount: row._count.users,
    studentCount: row._count.students,
    extracurricularCount: row._count.extracurriculars,
  };
}
