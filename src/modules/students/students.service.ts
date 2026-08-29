import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';

import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { buildPageMeta, pageSkip, type PaginatedResult } from '../../common/dto/pagination.dto.js';
import { generateQrToken } from '../../common/util/qr-token.js';
import { definedKeys } from '../../common/util/defined-keys.js';
import type { CreateStudentDto } from './dto/create-student.dto.js';
import type { ListStudentsQueryDto } from './dto/list-students-query.dto.js';
import type { UpdateStudentDto } from './dto/update-student.dto.js';

interface Actor {
  id: string;
  ip: string | null;
}

const PUBLIC_SELECT = {
  id: true,
  nis: true,
  fullName: true,
  classGrade: true,
  gender: true,
  dateOfBirth: true,
  photoUrl: true,
  qrToken: true,
  qrTokenRotatedAt: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.StudentSelect;

@Injectable()
export class StudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListStudentsQueryDto): Promise<PaginatedResult<unknown>> {
    const where: Prisma.StudentWhereInput = {};
    if (query.search) {
      where.OR = [
        { nis: { contains: query.search, mode: 'insensitive' } },
        { fullName: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.classGrade) where.classGrade = query.classGrade;
    if (query.isActive === 'true') where.isActive = true;
    if (query.isActive === 'false') where.isActive = false;

    const [total, data] = await this.prisma.$transaction([
      this.prisma.student.count({ where }),
      this.prisma.student.findMany({
        where,
        select: PUBLIC_SELECT,
        orderBy: [{ classGrade: 'asc' }, { fullName: 'asc' }],
        skip: pageSkip(query.page, query.pageSize),
        take: query.pageSize,
      }),
    ]);

    return { data, meta: buildPageMeta(query.page, query.pageSize, total) };
  }

  async getById(id: string) {
    const student = await this.prisma.student.findUnique({
      where: { id },
      select: PUBLIC_SELECT,
    });
    if (!student) throw new NotFoundException('Siswa tidak ditemukan.');
    return student;
  }

  async create(dto: CreateStudentDto, actor: Actor) {
    await this.assertNisAvailable(dto.nis);

    const student = await this.prisma.student.create({
      data: {
        nis: dto.nis,
        fullName: dto.fullName,
        classGrade: dto.classGrade,
        gender: dto.gender ?? null,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
        photoUrl: dto.photoUrl ?? null,
        qrToken: generateQrToken(),
      },
      select: PUBLIC_SELECT,
    });

    await this.audit.log({
      userId: actor.id,
      action: 'CREATE_STUDENT',
      entityType: 'student',
      entityId: student.id,
      ipAddress: actor.ip,
      metadata: { nis: student.nis },
    });
    return student;
  }

  async update(id: string, dto: UpdateStudentDto, actor: Actor) {
    await this.getById(id); // 404 guard
    if (dto.nis) await this.assertNisAvailable(dto.nis, id);

    const student = await this.prisma.student.update({
      where: { id },
      data: {
        nis: dto.nis,
        fullName: dto.fullName,
        classGrade: dto.classGrade,
        gender: dto.gender,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
        photoUrl: dto.photoUrl,
      },
      select: PUBLIC_SELECT,
    });

    await this.audit.log({
      userId: actor.id,
      action: 'UPDATE_STUDENT',
      entityType: 'student',
      entityId: id,
      ipAddress: actor.ip,
      metadata: { fields: definedKeys(dto as Record<string, unknown>) },
    });
    return student;
  }

  /**
   * Soft-delete: set is_active = false. TIDAK menghapus baris — data presensi
   * historis (attendance_details.student_id) tetap valid secara referensial.
   */
  async deactivate(id: string, actor: Actor) {
    await this.getById(id);
    const student = await this.prisma.student.update({
      where: { id },
      data: { isActive: false },
      select: PUBLIC_SELECT,
    });
    await this.audit.log({
      userId: actor.id,
      action: 'DEACTIVATE_STUDENT',
      entityType: 'student',
      entityId: id,
      ipAddress: actor.ip,
    });
    return student;
  }

  async reactivate(id: string, actor: Actor) {
    await this.getById(id);
    const student = await this.prisma.student.update({
      where: { id },
      data: { isActive: true },
      select: PUBLIC_SELECT,
    });
    await this.audit.log({
      userId: actor.id,
      action: 'REACTIVATE_STUDENT',
      entityType: 'student',
      entityId: id,
      ipAddress: actor.ip,
    });
    return student;
  }

  /**
   * Rotasi qr_token (kartu hilang). Token lama LANGSUNG tidak berlaku karena
   * kolom `qr_token` ditimpa nilai acak baru.
   */
  async rotateQrToken(id: string, actor: Actor) {
    await this.getById(id);
    const student = await this.prisma.student.update({
      where: { id },
      data: { qrToken: generateQrToken(), qrTokenRotatedAt: new Date() },
      select: PUBLIC_SELECT,
    });
    await this.audit.log({
      userId: actor.id,
      action: 'ROTATE_QR_TOKEN',
      entityType: 'student',
      entityId: id,
      ipAddress: actor.ip,
    });
    return student;
  }

  /**
   * Import massal dari file Excel (.xlsx). Kolom yang dibaca (baris 1 = header,
   * case-insensitive): nis, nama|full_name, kelas|class_grade, gender (L/P, opsional),
   * tanggal_lahir|date_of_birth (opsional).
   *
   * Baris yang gagal validasi / NIS duplikat dilewati dan dilaporkan; sisanya
   * dimasukkan dalam satu `createMany` (cepat untuk ratusan baris).
   */
  async importFromExcel(buffer: Buffer, actor: Actor) {
    const workbook = new ExcelJS.Workbook();
    // `as never`: types-only workaround untuk mismatch Buffer (Node 22 @types/node vs
    // tipe Buffer bawaan exceljs). Runtime menerima Buffer dengan benar.
    await workbook.xlsx.load(buffer as never);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new ConflictException('File Excel tidak memiliki worksheet.');

    const headerRow = sheet.getRow(1);
    const colIndex = this.mapHeaderColumns(headerRow);
    if (colIndex.nis == null || colIndex.fullName == null || colIndex.classGrade == null) {
      throw new ConflictException(
        'Header wajib tidak lengkap. Minimal kolom: nis, nama, kelas.',
      );
    }

    const errors: { row: number; message: string }[] = [];
    const seenNis = new Set<string>();
    const candidates: Prisma.StudentCreateManyInput[] = [];

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const nis = this.cellString(row, colIndex.nis!);
      const fullName = this.cellString(row, colIndex.fullName!);
      const classGrade = this.cellString(row, colIndex.classGrade!);
      if (!nis && !fullName && !classGrade) return; // baris kosong

      if (!nis || !fullName || !classGrade) {
        errors.push({ row: rowNumber, message: 'nis / nama / kelas kosong.' });
        return;
      }
      if (seenNis.has(nis)) {
        errors.push({ row: rowNumber, message: `NIS ${nis} duplikat di dalam file.` });
        return;
      }
      const genderRaw = colIndex.gender != null ? this.cellString(row, colIndex.gender).toUpperCase() : '';
      const gender = genderRaw === 'L' || genderRaw === 'P' ? genderRaw : null;
      if (genderRaw && !gender) {
        errors.push({ row: rowNumber, message: `gender '${genderRaw}' tidak valid (L/P).` });
        return;
      }
      const dobRaw = colIndex.dateOfBirth != null ? this.cellDate(row, colIndex.dateOfBirth) : null;

      seenNis.add(nis);
      candidates.push({
        nis,
        fullName,
        classGrade,
        gender,
        dateOfBirth: dobRaw,
        qrToken: generateQrToken(),
      });
    });

    // Buang NIS yang sudah ada di DB.
    const existing = candidates.length
      ? await this.prisma.student.findMany({
          where: { nis: { in: candidates.map((c) => c.nis) } },
          select: { nis: true },
        })
      : [];
    const existingNis = new Set(existing.map((e) => e.nis));
    const toInsert = candidates.filter((c) => {
      if (existingNis.has(c.nis)) {
        errors.push({ row: -1, message: `NIS ${c.nis} sudah terdaftar, dilewati.` });
        return false;
      }
      return true;
    });

    let created = 0;
    if (toInsert.length) {
      const result = await this.prisma.student.createMany({
        data: toInsert,
        skipDuplicates: true,
      });
      created = result.count;
    }

    await this.audit.log({
      userId: actor.id,
      action: 'IMPORT_STUDENTS',
      entityType: 'student',
      entityId: null,
      ipAddress: actor.ip,
      metadata: { created, skipped: errors.length, totalRows: candidates.length + errors.length },
    });

    return { created, skipped: errors.length, errors };
  }

  // --- helpers ---

  private async assertNisAvailable(nis: string, exceptId?: string) {
    const found = await this.prisma.student.findUnique({ where: { nis }, select: { id: true } });
    if (found && found.id !== exceptId) {
      throw new ConflictException(`NIS ${nis} sudah dipakai siswa lain.`);
    }
  }

  private mapHeaderColumns(headerRow: ExcelJS.Row) {
    const idx: Record<string, number | undefined> = {};
    headerRow.eachCell((cell, colNumber) => {
      const key = String(cell.value ?? '').trim().toLowerCase();
      if (['nis', 'no induk', 'nomor induk'].includes(key)) idx.nis = colNumber;
      else if (['nama', 'full_name', 'nama lengkap', 'fullname'].includes(key)) idx.fullName = colNumber;
      else if (['kelas', 'class_grade', 'classgrade'].includes(key)) idx.classGrade = colNumber;
      else if (['gender', 'jk', 'jenis kelamin'].includes(key)) idx.gender = colNumber;
      else if (['tanggal_lahir', 'date_of_birth', 'tgl lahir', 'dob'].includes(key))
        idx.dateOfBirth = colNumber;
    });
    return idx;
  }

  private cellString(row: ExcelJS.Row, col: number): string {
    const v = row.getCell(col).value;
    if (v == null) return '';
    if (typeof v === 'object' && 'text' in v) return String(v.text).trim();
    return String(v).trim();
  }

  private cellDate(row: ExcelJS.Row, col: number): Date | null {
    const v = row.getCell(col).value;
    if (v instanceof Date) return v;
    if (typeof v === 'string' && v.trim()) {
      const d = new Date(v.trim());
      return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
  }
}
