import {
  ConflictException,
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditService } from '../audit/audit.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { ReportSigner } from './report-signer.js';
import { ReportsService } from './reports.service.js';
import type { ReportStorage } from './storage/report-storage.js';

const CFG: Record<string, unknown> = {
  apiPrefix: 'api/v1',
  'reports.signingSecret': 'test-secret',
  'reports.signedUrlTtlSeconds': 3600,
};
const config = { get: (k: string) => CFG[k] } as unknown as ConfigService;

function signedParams(id: string) {
  const { path } = new ReportSigner(config).buildDownloadPath(id);
  const url = new URL('http://x' + path);
  return { expires: Number(url.searchParams.get('expires')), sig: url.searchParams.get('sig')! };
}

describe('ReportsService', () => {
  let prisma: any;
  let audit: { log: ReturnType<typeof vi.fn> };
  let storage: ReportStorage & Record<string, ReturnType<typeof vi.fn>>;
  let queue: { add: ReturnType<typeof vi.fn> };
  let service: ReportsService;

  beforeEach(() => {
    prisma = {
      reportExport: {
        create: vi.fn().mockResolvedValue({
          id: 'exp-1',
          status: 'PENDING',
          format: 'xlsx',
          createdAt: new Date('2026-08-29T10:00:00Z'),
        }),
        findUnique: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([]),
      },
      // dipakai buildAttendanceDataset
      extracurricularMember: { findMany: vi.fn().mockResolvedValue([]) },
      attendanceSession: { findMany: vi.fn().mockResolvedValue([]) },
      attendanceDetail: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn((arr: Promise<unknown>[]) => Promise.all(arr)),
    };
    audit = { log: vi.fn().mockResolvedValue(undefined) };
    storage = {
      put: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(Buffer.from('FILE')),
      remove: vi.fn().mockResolvedValue(undefined),
    } as never;
    queue = { add: vi.fn().mockResolvedValue(undefined) };
    service = new ReportsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      new ReportSigner(config),
      config,
      storage,
      queue as never,
    );
  });

  describe('requestExport', () => {
    it('membuat baris PENDING, mencatat audit EXPORT_REPORT + filter, lalu enqueue job', async () => {
      const res = await service.requestExport(
        { format: 'xlsx', classGrade: '4A', dateFrom: '2026-01-01', dateTo: '2026-06-01' } as never,
        { userId: 'admin-1', ip: '1.2.3.4' },
      );

      expect(prisma.reportExport.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            requestedById: 'admin-1',
            format: 'xlsx',
            status: 'PENDING',
            filters: { classGrade: '4A', dateFrom: '2026-01-01', dateTo: '2026-06-01' },
          }),
        }),
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'EXPORT_REPORT',
          entityType: 'report_export',
          entityId: 'exp-1',
          metadata: expect.objectContaining({
            format: 'xlsx',
            filters: { classGrade: '4A', dateFrom: '2026-01-01', dateTo: '2026-06-01' },
          }),
        }),
      );
      expect(queue.add).toHaveBeenCalledWith(
        'generate-report',
        { exportId: 'exp-1' },
        { jobId: 'report_exp-1' },
      );
      expect(res).toMatchObject({ id: 'exp-1', status: 'PENDING', format: 'xlsx' });
    });

    it('gagal enqueue → baris ditandai FAILED dan melempar ConflictException', async () => {
      queue.add.mockRejectedValue(new Error('redis down'));
      await expect(
        service.requestExport({ format: 'pdf' } as never, { userId: 'admin-1', ip: null }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.reportExport.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'exp-1' }, data: expect.objectContaining({ status: 'FAILED' }) }),
      );
    });
  });

  describe('runExportJob', () => {
    it('PENDING → PROCESSING → READY: file disimpan ke storage + metadata terisi', async () => {
      prisma.reportExport.findUnique.mockResolvedValue({
        id: 'exp-1',
        format: 'xlsx',
        status: 'PENDING',
        filters: { dateFrom: '2026-01-01', dateTo: '2026-06-01' },
      });

      const out = await service.runExportJob('exp-1');

      expect(prisma.reportExport.update).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ data: expect.objectContaining({ status: 'PROCESSING' }) }),
      );
      expect(storage.put).toHaveBeenCalledTimes(1);
      const [key, buf, ctype] = storage.put.mock.calls[0];
      expect(key).toMatch(/^attendance\/\d{4}\/exp-1\.xlsx$/);
      expect(Buffer.isBuffer(buf)).toBe(true);
      expect(ctype).toContain('spreadsheetml');
      expect(prisma.reportExport.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'READY',
            storageKey: expect.stringMatching(/exp-1\.xlsx$/),
            fileName: 'laporan-kehadiran_2026-01-01_sd_2026-06-01.xlsx',
            rowCount: 0,
            expiresAt: expect.any(Date),
          }),
        }),
      );
      expect(out.rowCount).toBe(0);
    });

    it('render/simpan gagal → status FAILED + errorMessage, lalu rethrow (untuk retry BullMQ)', async () => {
      prisma.reportExport.findUnique.mockResolvedValue({
        id: 'exp-1',
        format: 'pdf',
        status: 'PENDING',
        filters: {},
      });
      storage.put.mockRejectedValue(new Error('disk penuh'));

      await expect(service.runExportJob('exp-1')).rejects.toThrow('disk penuh');
      expect(prisma.reportExport.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'FAILED', errorMessage: 'disk penuh' }),
        }),
      );
    });

    it('idempoten: job untuk export yang sudah READY tidak dikerjakan ulang', async () => {
      prisma.reportExport.findUnique.mockResolvedValue({
        id: 'exp-1',
        format: 'pdf',
        status: 'READY',
        rowCount: 12,
        fileSize: 999,
        filters: {},
      });
      const out = await service.runExportJob('exp-1');
      expect(out).toEqual({ rowCount: 12, fileSize: 999 });
      expect(prisma.reportExport.update).not.toHaveBeenCalled();
      expect(storage.put).not.toHaveBeenCalled();
    });
  });

  describe('resolveDownload', () => {
    it('signature salah → ForbiddenException, tidak menyentuh DB', async () => {
      await expect(service.resolveDownload('exp-1', 9999999999, 'bogus')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.reportExport.findUnique).not.toHaveBeenCalled();
    });

    it('signature valid tapi export belum READY → ConflictException', async () => {
      const { expires, sig } = signedParams('exp-1');
      prisma.reportExport.findUnique.mockResolvedValue({ id: 'exp-1', status: 'PENDING', format: 'pdf' });
      await expect(service.resolveDownload('exp-1', expires, sig)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('signature valid, READY, tapi file sudah lewat masa simpan → GoneException', async () => {
      const { expires, sig } = signedParams('exp-1');
      prisma.reportExport.findUnique.mockResolvedValue({
        id: 'exp-1',
        status: 'READY',
        format: 'pdf',
        storageKey: 'attendance/2026/exp-1.pdf',
        fileName: 'laporan.pdf',
        expiresAt: new Date(Date.now() - 1000),
      });
      await expect(service.resolveDownload('exp-1', expires, sig)).rejects.toBeInstanceOf(
        GoneException,
      );
    });

    it('signature valid + READY + belum kedaluwarsa → mengembalikan buffer & metadata file', async () => {
      const { expires, sig } = signedParams('exp-1');
      prisma.reportExport.findUnique.mockResolvedValue({
        id: 'exp-1',
        status: 'READY',
        format: 'pdf',
        storageKey: 'attendance/2026/exp-1.pdf',
        fileName: 'laporan.pdf',
        expiresAt: new Date(Date.now() + 60_000),
      });
      const res = await service.resolveDownload('exp-1', expires, sig);
      expect(storage.get).toHaveBeenCalledWith('attendance/2026/exp-1.pdf');
      expect(res).toMatchObject({ fileName: 'laporan.pdf', contentType: 'application/pdf' });
      expect(res.buffer.toString()).toBe('FILE');
    });
  });

  describe('getExport', () => {
    it('tidak ada → NotFoundException', async () => {
      prisma.reportExport.findUnique.mockResolvedValue(null);
      await expect(service.getExport('nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('READY → downloadUrl signed di bawah prefix API; PENDING → downloadUrl null', async () => {
      prisma.reportExport.findUnique.mockResolvedValueOnce({
        id: 'exp-1',
        status: 'READY',
        expiresAt: new Date(Date.now() + 60_000),
      });
      const ready = await service.getExport('exp-1');
      expect(ready.downloadUrl).toMatch(/^\/api\/v1\/admin\/reports\/downloads\/exp-1\?expires=\d+&sig=/);
      expect(ready.downloadExpiresAt).toEqual(expect.any(String));

      prisma.reportExport.findUnique.mockResolvedValueOnce({
        id: 'exp-2',
        status: 'PENDING',
        expiresAt: null,
      });
      const pending = await service.getExport('exp-2');
      expect(pending.downloadUrl).toBeNull();
    });
  });
});
