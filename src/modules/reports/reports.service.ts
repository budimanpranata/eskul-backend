import { InjectQueue } from '@nestjs/bullmq';
import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import {
  buildPageMeta,
  pageSkip,
  type PaginatedResult,
} from '../../common/dto/pagination.dto.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { REPORTS_QUEUE } from '../../queue/queue.module.js';
import type { ReportExportQueryDto, ReportPreviewQueryDto } from './dto/report-query.dto.js';
import { ReportSigner } from './report-signer.js';
import {
  buildAttendanceDataset,
  resolveRange,
  type ReportFilters,
} from './render/attendance-dataset.js';
import { renderAttendancePdf } from './render/pdf-renderer.js';
import { renderAttendanceXlsx } from './render/xlsx-renderer.js';
import { REPORT_STORAGE, type ReportStorage } from './storage/report-storage.js';

export const JOB_GENERATE_REPORT = 'generate-report';

const CONTENT_TYPE: Record<string, string> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

interface Actor {
  userId: string;
  ip: string | null;
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);
  private readonly apiPrefix: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly signer: ReportSigner,
    private readonly config: ConfigService,
    @Inject(REPORT_STORAGE) private readonly storage: ReportStorage,
    @InjectQueue(REPORTS_QUEUE) private readonly queue: Queue,
  ) {
    this.apiPrefix = (this.config.get<string>('apiPrefix') ?? 'api/v1').replace(/^\/|\/$/g, '');
  }

  private static filtersOf(dto: {
    classGrade?: string;
    extracurricularId?: string;
    dateFrom?: string;
    dateTo?: string;
  }): ReportFilters {
    const f: ReportFilters = {};
    if (dto.classGrade) f.classGrade = dto.classGrade;
    if (dto.extracurricularId) f.extracurricularId = dto.extracurricularId;
    if (dto.dateFrom) f.dateFrom = dto.dateFrom;
    if (dto.dateTo) f.dateTo = dto.dateTo;
    return f;
  }

  /** GET /admin/reports/attendance/preview — tabel data sebelum export. */
  async preview(query: ReportPreviewQueryDto): Promise<PaginatedResult<unknown>> {
    const filters = ReportsService.filtersOf(query);
    const ds = await buildAttendanceDataset(this.prisma, filters);
    const start = pageSkip(query.page, query.pageSize);
    const pageRows = ds.rows.slice(start, start + query.pageSize);
    return {
      data: pageRows,
      meta: {
        ...buildPageMeta(query.page, query.pageSize, ds.rows.length),
        dateFrom: ds.filters.dateFrom,
        dateTo: ds.filters.dateTo,
      } as never,
    };
  }

  /**
   * GET /admin/reports/attendance?format=pdf|xlsx — memicu job export ASINKRON.
   * Tidak menghasilkan file di request thread (DoD: 500 siswa tanpa timeout).
   */
  async requestExport(query: ReportExportQueryDto, actor: Actor) {
    const filters = ReportsService.filtersOf(query);
    const { dateFrom, dateTo } = resolveRange(filters);

    const record = await this.prisma.reportExport.create({
      data: {
        requestedById: actor.userId,
        reportType: 'attendance',
        format: query.format,
        filters: { ...filters, dateFrom, dateTo },
        status: 'PENDING',
      },
      select: { id: true, status: true, format: true, createdAt: true },
    });

    await this.audit.log({
      userId: actor.userId,
      action: 'EXPORT_REPORT',
      entityType: 'report_export',
      entityId: record.id,
      ipAddress: actor.ip,
      metadata: { reportType: 'attendance', format: query.format, filters: { ...filters, dateFrom, dateTo } },
    });

    try {
      await this.queue.add(
        JOB_GENERATE_REPORT,
        { exportId: record.id },
        { jobId: `report_${record.id}` },
      );
    } catch (err) {
      this.logger.error(`Gagal enqueue job export ${record.id}: ${(err as Error).message}`);
      await this.prisma.reportExport.update({
        where: { id: record.id },
        data: { status: 'FAILED', errorMessage: 'Gagal menaruh job ke antrean.' },
      });
      throw new ConflictException('Gagal memulai proses export. Coba lagi.');
    }

    return {
      id: record.id,
      status: record.status,
      format: record.format,
      filters: { ...filters, dateFrom, dateTo },
      createdAt: record.createdAt,
    };
  }

  /** GET /admin/reports/exports — riwayat permintaan export. */
  async listExports(query: {
    page: number;
    pageSize: number;
  }): Promise<PaginatedResult<unknown>> {
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.reportExport.count(),
      this.prisma.reportExport.findMany({
        orderBy: { createdAt: 'desc' },
        skip: pageSkip(query.page, query.pageSize),
        take: query.pageSize,
        select: {
          id: true,
          format: true,
          reportType: true,
          filters: true,
          status: true,
          fileName: true,
          fileSize: true,
          rowCount: true,
          errorMessage: true,
          expiresAt: true,
          completedAt: true,
          createdAt: true,
          requestedBy: { select: { fullName: true } },
        },
      }),
    ]);
    return {
      data: rows.map((r) => this.decorate(r)),
      meta: buildPageMeta(query.page, query.pageSize, total) as never,
    };
  }

  /** GET /admin/reports/exports/:id — status + (bila siap) signed download URL. */
  async getExport(id: string) {
    const row = await this.prisma.reportExport.findUnique({
      where: { id },
      select: {
        id: true,
        format: true,
        reportType: true,
        filters: true,
        status: true,
        fileName: true,
        fileSize: true,
        rowCount: true,
        errorMessage: true,
        expiresAt: true,
        completedAt: true,
        createdAt: true,
        requestedBy: { select: { fullName: true } },
      },
    });
    if (!row) throw new NotFoundException('Permintaan export tidak ditemukan.');
    return this.decorate(row);
  }

  /**
   * GET /admin/reports/downloads/:id — stream file. Route `@Public()`; otorisasi
   * dari signature HMAC + `expires` (DoD: tak bisa diakses tanpa signed URL valid).
   */
  async resolveDownload(id: string, expires: number, sig: string) {
    if (!this.signer.verify(id, expires, sig)) {
      // Signature salah ATAU sudah lewat `expires`.
      const looksExpired = Number.isFinite(expires) && expires * 1000 < Date.now();
      if (looksExpired) throw new GoneException('Tautan unduhan sudah kedaluwarsa.');
      throw new ForbiddenException('Tautan unduhan tidak valid.');
    }
    const row = await this.prisma.reportExport.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('File export tidak ditemukan.');
    if (row.status !== 'READY' || !row.storageKey) {
      throw new ConflictException(`Export belum siap (status: ${row.status}).`);
    }
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
      throw new GoneException('File export sudah kedaluwarsa.');
    }
    const buffer = await this.storage.get(row.storageKey);
    return {
      buffer,
      fileName: row.fileName ?? `laporan.${row.format}`,
      contentType: CONTENT_TYPE[row.format] ?? 'application/octet-stream',
    };
  }

  /**
   * Dijalankan oleh worker (ReportsProcessor). Query data → render file → simpan
   * ke storage → tandai READY + signed URL info.
   */
  async runExportJob(exportId: string): Promise<{ rowCount: number; fileSize: number }> {
    const record = await this.prisma.reportExport.findUnique({ where: { id: exportId } });
    if (!record) throw new Error(`ReportExport ${exportId} tidak ada.`);
    if (record.status === 'READY') {
      return { rowCount: record.rowCount ?? 0, fileSize: record.fileSize ?? 0 };
    }

    await this.prisma.reportExport.update({
      where: { id: exportId },
      data: { status: 'PROCESSING', startedAt: new Date(), errorMessage: null },
    });

    try {
      const filters = (record.filters ?? {}) as ReportFilters;
      const ds = await buildAttendanceDataset(this.prisma, filters);
      const buffer =
        record.format === 'pdf'
          ? await renderAttendancePdf(ds)
          : await renderAttendanceXlsx(ds);

      const year = new Date().getUTCFullYear();
      const storageKey = `attendance/${year}/${exportId}.${record.format}`;
      const fileName = this.buildFileName(ds.filters, record.format);
      await this.storage.put(storageKey, buffer, CONTENT_TYPE[record.format]);

      const ttl = this.config.get<number>('reports.signedUrlTtlSeconds') ?? 3600;
      const expiresAt = new Date(Date.now() + ttl * 1000);

      await this.prisma.reportExport.update({
        where: { id: exportId },
        data: {
          status: 'READY',
          storageKey,
          fileName,
          fileSize: buffer.length,
          rowCount: ds.rows.length,
          expiresAt,
          completedAt: new Date(),
        },
      });
      this.logger.log(
        `Export ${exportId} (${record.format}) siap — ${ds.rows.length} baris, ${buffer.length} byte.`,
      );
      return { rowCount: ds.rows.length, fileSize: buffer.length };
    } catch (err) {
      await this.prisma.reportExport.update({
        where: { id: exportId },
        data: { status: 'FAILED', errorMessage: (err as Error).message.slice(0, 500) },
      });
      throw err;
    }
  }

  // --- helpers ---

  private buildFileName(
    filters: { dateFrom: string; dateTo: string; classGrade?: string },
    format: string,
  ): string {
    const cls = filters.classGrade ? `_${filters.classGrade}` : '';
    return `laporan-kehadiran_${filters.dateFrom}_sd_${filters.dateTo}${cls}.${format}`;
  }

  private decorate<
    T extends { id: string; status: string; expiresAt: Date | null },
  >(row: T): T & { downloadUrl: string | null; downloadExpiresAt: string | null } {
    const expired = !!row.expiresAt && row.expiresAt.getTime() < Date.now();
    if (row.status !== 'READY' || expired) {
      return { ...row, downloadUrl: null, downloadExpiresAt: null };
    }
    const { path, expiresAt } = this.signer.buildDownloadPath(row.id);
    return {
      ...row,
      downloadUrl: `/${this.apiPrefix}${path}`,
      downloadExpiresAt: expiresAt.toISOString(),
    };
  }
}
