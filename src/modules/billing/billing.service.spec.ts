import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BillingService } from './billing.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { BillingProofSigner } from './billing-proof-signer.js';

describe('BillingService', () => {
  let prisma: any;
  let audit: { log: ReturnType<typeof vi.fn> };
  let notifications: { enqueueUserNotification: ReturnType<typeof vi.fn> };
  let signer: { buildProofPath: ReturnType<typeof vi.fn>; verify: ReturnType<typeof vi.fn> };
  let storage: { put: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
  let service: BillingService;

  const actor = (schoolId: string | undefined = 'school-1') => ({ id: 'admin-1', ip: null, schoolId });

  beforeEach(() => {
    prisma = {
      extracurricular: { findFirst: vi.fn() },
      extracurricularMember: { findMany: vi.fn().mockResolvedValue([]) },
      student: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn() },
      invoice: {
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn(),
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        groupBy: vi.fn().mockResolvedValue([]),
      },
      payment: {
        create: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        update: vi.fn(),
        findUnique: vi.fn(),
      },
      parentStudentRelation: { findFirst: vi.fn() },
      $transaction: vi.fn((arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg))),
    };
    audit = { log: vi.fn().mockResolvedValue(undefined) };
    notifications = { enqueueUserNotification: vi.fn().mockResolvedValue(undefined) };
    signer = {
      buildProofPath: vi.fn(() => ({ path: '/billing/payments/p1/proof?expires=1&sig=x', expiresAt: new Date() })),
      verify: vi.fn(() => true),
    };
    storage = { put: vi.fn().mockResolvedValue(undefined), get: vi.fn(), remove: vi.fn() };
    const config = { get: vi.fn().mockReturnValue(undefined) };
    service = new BillingService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      notifications as unknown as NotificationsService,
      signer as unknown as BillingProofSigner,
      config as any,
      storage as any,
    );
  });

  describe('generateInvoices', () => {
    it('ekskul tidak ditemukan di sekolah ini → 404', async () => {
      prisma.extracurricular.findFirst.mockResolvedValue(null);
      await expect(
        service.generateInvoices(
          { period: '2026-10', title: 'SPP', amount: 50000, extracurricularId: 'e1' } as any,
          actor(),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('dengan extracurricularId → generate utk anggota aktif saja, skipDuplicates', async () => {
      prisma.extracurricular.findFirst.mockResolvedValue({ id: 'e1' });
      prisma.extracurricularMember.findMany.mockResolvedValue([{ studentId: 's1' }, { studentId: 's2' }]);
      prisma.invoice.createMany.mockResolvedValue({ count: 1 });

      const res = await service.generateInvoices(
        { period: '2026-10', title: 'SPP Futsal', amount: 50000, extracurricularId: 'e1' } as any,
        actor(),
      );

      expect(prisma.invoice.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            expect.objectContaining({ studentId: 's1', extracurricularId: 'e1', period: '2026-10' }),
            expect.objectContaining({ studentId: 's2', extracurricularId: 'e1' }),
          ],
          skipDuplicates: true,
        }),
      );
      expect(res).toEqual({ created: 1, skipped: 1, totalMatched: 2 });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'GENERATE_INVOICES' }));
    });

    it('tanpa extracurricularId → generate per siswa (tagihan umum), scoped ke sekolah actor', async () => {
      prisma.student.findMany.mockResolvedValue([{ id: 's1' }]);
      prisma.invoice.createMany.mockResolvedValue({ count: 1 });

      await service.generateInvoices({ period: '2026-10', title: 'Daftar Ulang', amount: 100000 } as any, actor());

      expect(prisma.student.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ isActive: true, schoolId: 'school-1' }) }),
      );
      expect(prisma.invoice.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: [expect.objectContaining({ studentId: 's1', extracurricularId: null })] }),
      );
    });

    it('REGRESI: tanpa extracurricularId, re-generate periode sama → semua skip (bukan createMany mentah-mentah)', async () => {
      // Postgres menganggap NULL != NULL pada UNIQUE(student_id, extracurricular_id, period),
      // jadi `skipDuplicates` SAJA tidak cukup saat extracurricularId null — service harus
      // memfilter manual terhadap invoice yang sudah ada dulu.
      prisma.student.findMany.mockResolvedValue([{ id: 's1' }, { id: 's2' }]);
      prisma.invoice.findMany.mockResolvedValue([{ studentId: 's1' }]); // s1 sudah py invoice periode ini
      prisma.invoice.createMany.mockResolvedValue({ count: 1 }); // hanya s2 yang dibuat

      const res = await service.generateInvoices({ period: '2026-10', title: 'X', amount: 1000 } as any, actor());

      expect(prisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ extracurricularId: null, period: '2026-10' }) }),
      );
      expect(prisma.invoice.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: [expect.objectContaining({ studentId: 's2' })] }),
      );
      expect(res).toEqual({ created: 1, skipped: 1, totalMatched: 2 });
    });

    it('tidak ada siswa cocok → created/skipped 0, tidak query createMany', async () => {
      prisma.student.findMany.mockResolvedValue([]);
      const res = await service.generateInvoices({ period: '2026-10', title: 'X', amount: 1000 } as any, actor());
      expect(res).toEqual({ created: 0, skipped: 0, totalMatched: 0 });
      expect(prisma.invoice.createMany).not.toHaveBeenCalled();
    });
  });

  describe('createInvoice', () => {
    it('siswa tidak ditemukan → 404', async () => {
      prisma.student.findFirst.mockResolvedValue(null);
      await expect(
        service.createInvoice({ studentId: 's1', period: '2026-10', title: 'X', amount: 1000 } as any, actor()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('REGRESI: duplikat tagihan umum (extracurricularId null) terdeteksi via cek manual, bukan hanya P2002', async () => {
      prisma.student.findFirst.mockResolvedValue({ id: 's1' });
      prisma.invoice.findFirst.mockResolvedValue({ id: 'inv-existing' });
      await expect(
        service.createInvoice({ studentId: 's1', period: '2026-10', title: 'X', amount: 1000 } as any, actor()),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.invoice.create).not.toHaveBeenCalled();
    });

    it('duplikat (studentId+ekskul+period) → 409', async () => {
      prisma.student.findFirst.mockResolvedValue({ id: 's1' });
      const err = Object.assign(new Error('unique'), { code: 'P2002' });
      Object.setPrototypeOf(err, (await import('@prisma/client')).Prisma.PrismaClientKnownRequestError.prototype);
      prisma.invoice.create.mockRejectedValue(err);
      await expect(
        service.createInvoice({ studentId: 's1', period: '2026-10', title: 'X', amount: 1000 } as any, actor()),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('cancelInvoice', () => {
    it('tidak ditemukan → 404', async () => {
      prisma.invoice.findFirst.mockResolvedValue(null);
      await expect(service.cancelInvoice('inv-1', actor())).rejects.toBeInstanceOf(NotFoundException);
    });

    it('status bukan UNPAID → 409', async () => {
      prisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1', status: 'PAID' });
      await expect(service.cancelInvoice('inv-1', actor())).rejects.toBeInstanceOf(ConflictException);
    });

    it('UNPAID → CANCELLED', async () => {
      prisma.invoice.findFirst.mockResolvedValueOnce({ id: 'inv-1', status: 'UNPAID' });
      prisma.invoice.findFirst.mockResolvedValueOnce({
        id: 'inv-1',
        period: '2026-10',
        title: 'X',
        amount: 1000,
        dueDate: null,
        status: 'CANCELLED',
        notes: null,
        createdAt: new Date(),
        student: { id: 's1', nis: 'N1', fullName: 'Budi', classGrade: '4A' },
        extracurricular: null,
        payments: [],
      });
      await service.cancelInvoice('inv-1', actor());
      expect(prisma.invoice.update).toHaveBeenCalledWith({ where: { id: 'inv-1' }, data: { status: 'CANCELLED' } });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'CANCEL_INVOICE' }));
    });
  });

  describe('report', () => {
    it('meringkas groupBy per status', async () => {
      prisma.invoice.groupBy.mockResolvedValue([
        { status: 'PAID', _count: { _all: 3 }, _sum: { amount: 150000 } },
        { status: 'UNPAID', _count: { _all: 2 }, _sum: { amount: 100000 } },
      ]);
      prisma.invoice.count.mockResolvedValue(5);
      const res = await service.report({ page: 1, pageSize: 20 } as any, 'school-1');
      expect(res.summary).toMatchObject({
        totalInvoices: 5,
        totalAmount: 250000,
        paid: { count: 3, amount: 150000 },
        unpaid: { count: 2, amount: 100000 },
        pendingVerification: { count: 0, amount: 0 },
        cancelled: { count: 0, amount: 0 },
      });
    });
  });

  describe('verifyPayment', () => {
    const paymentRow = {
      id: 'pay-1',
      status: 'PENDING',
      amount: 50000,
      invoiceId: 'inv-1',
      submittedById: 'parent-u1',
      invoice: { title: 'SPP', studentId: 's1', student: { fullName: 'Budi' } },
    };

    it('tidak ditemukan → 404', async () => {
      prisma.payment.findFirst.mockResolvedValue(null);
      await expect(
        service.verifyPayment('pay-1', { decision: 'APPROVED' } as any, actor()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('sudah diputuskan sebelumnya → 409', async () => {
      prisma.payment.findFirst.mockResolvedValue({ ...paymentRow, status: 'APPROVED' });
      await expect(
        service.verifyPayment('pay-1', { decision: 'APPROVED' } as any, actor()),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('APPROVED → payment APPROVED + invoice PAID + notifikasi', async () => {
      prisma.payment.findFirst.mockResolvedValue(paymentRow);
      prisma.invoice.findFirst.mockResolvedValue({
        id: 'inv-1',
        period: '2026-10',
        title: 'SPP',
        amount: 50000,
        dueDate: null,
        status: 'PAID',
        notes: null,
        createdAt: new Date(),
        student: { id: 's1', nis: 'N1', fullName: 'Budi', classGrade: '4A' },
        extracurricular: null,
        payments: [],
      });
      await service.verifyPayment('pay-1', { decision: 'APPROVED' } as any, actor());

      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'pay-1' }, data: expect.objectContaining({ status: 'APPROVED' }) }),
      );
      expect(prisma.invoice.update).toHaveBeenCalledWith({ where: { id: 'inv-1' }, data: { status: 'PAID' } });
      expect(notifications.enqueueUserNotification).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'parent-u1', type: 'PAYMENT_DECISION' }),
      );
    });

    it('REJECTED → payment REJECTED + invoice kembali UNPAID', async () => {
      prisma.payment.findFirst.mockResolvedValue(paymentRow);
      prisma.invoice.findFirst.mockResolvedValue({
        id: 'inv-1',
        period: '2026-10',
        title: 'SPP',
        amount: 50000,
        dueDate: null,
        status: 'UNPAID',
        notes: null,
        createdAt: new Date(),
        student: { id: 's1', nis: 'N1', fullName: 'Budi', classGrade: '4A' },
        extracurricular: null,
        payments: [],
      });
      await service.verifyPayment('pay-1', { decision: 'REJECTED', reason: 'Nominal tidak sesuai' } as any, actor());
      expect(prisma.invoice.update).toHaveBeenCalledWith({ where: { id: 'inv-1' }, data: { status: 'UNPAID' } });
    });
  });

  describe('parentInvoices / parentInvoiceDetail', () => {
    it('tanpa relasi APPROVED → 403 UNAUTHORIZED_RELATION', async () => {
      prisma.parentStudentRelation.findFirst.mockResolvedValue(null);
      await expect(service.parentInvoices('s1', undefined, 'u1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('relasi APPROVED → list invoice anak', async () => {
      prisma.parentStudentRelation.findFirst.mockResolvedValue({ id: 'r1' });
      prisma.invoice.findMany.mockResolvedValue([]);
      const res = await service.parentInvoices('s1', undefined, 'u1');
      expect(res).toEqual([]);
    });
  });

  describe('submitPayment', () => {
    const invoiceRow = { id: 'inv-1', studentId: 's1', amount: 50000, status: 'UNPAID' };

    it('invoice tidak ditemukan → 404', async () => {
      prisma.invoice.findUnique.mockResolvedValue(null);
      await expect(
        service.submitPayment('inv-1', 'CASH', undefined, undefined, { userId: 'u1', ip: null }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('bukan wali sah → 403', async () => {
      prisma.invoice.findUnique.mockResolvedValue(invoiceRow);
      prisma.parentStudentRelation.findFirst.mockResolvedValue(null);
      await expect(
        service.submitPayment('inv-1', 'CASH', undefined, undefined, { userId: 'u1', ip: null }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('TRANSFER tanpa file → 400', async () => {
      prisma.invoice.findUnique.mockResolvedValue(invoiceRow);
      prisma.parentStudentRelation.findFirst.mockResolvedValue({ id: 'r1' });
      await expect(
        service.submitPayment('inv-1', 'TRANSFER', undefined, undefined, { userId: 'u1', ip: null }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('invoice sudah PENDING_VERIFICATION → 409', async () => {
      prisma.invoice.findUnique.mockResolvedValue({ ...invoiceRow, status: 'PENDING_VERIFICATION' });
      prisma.parentStudentRelation.findFirst.mockResolvedValue({ id: 'r1' });
      await expect(
        service.submitPayment('inv-1', 'CASH', undefined, undefined, { userId: 'u1', ip: null }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('CASH sukses → payment PENDING + invoice PENDING_VERIFICATION', async () => {
      prisma.invoice.findUnique.mockResolvedValue(invoiceRow);
      prisma.parentStudentRelation.findFirst.mockResolvedValue({ id: 'r1' });
      prisma.payment.create.mockResolvedValue({ id: 'pay-1' });
      prisma.invoice.findFirst.mockResolvedValue({
        id: 'inv-1',
        period: '2026-10',
        title: 'SPP',
        amount: 50000,
        dueDate: null,
        status: 'PENDING_VERIFICATION',
        notes: null,
        createdAt: new Date(),
        student: { id: 's1', nis: 'N1', fullName: 'Budi', classGrade: '4A' },
        extracurricular: null,
        payments: [],
      });

      await service.submitPayment('inv-1', 'CASH', 'bayar tunai ke bu guru', undefined, {
        userId: 'u1',
        ip: '1.2.3.4',
      });

      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ invoiceId: 'inv-1', method: 'CASH', proofKey: null }),
        }),
      );
      expect(prisma.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { status: 'PENDING_VERIFICATION' },
      });
      expect(storage.put).not.toHaveBeenCalled();
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'SUBMIT_PAYMENT' }));
    });

    it('TRANSFER dengan file valid → disimpan ke storage, proofKey terisi', async () => {
      prisma.invoice.findUnique.mockResolvedValue(invoiceRow);
      prisma.parentStudentRelation.findFirst.mockResolvedValue({ id: 'r1' });
      prisma.payment.create.mockResolvedValue({ id: 'pay-1' });
      prisma.invoice.findFirst.mockResolvedValue({
        id: 'inv-1',
        period: '2026-10',
        title: 'SPP',
        amount: 50000,
        dueDate: null,
        status: 'PENDING_VERIFICATION',
        notes: null,
        createdAt: new Date(),
        student: { id: 's1', nis: 'N1', fullName: 'Budi', classGrade: '4A' },
        extracurricular: null,
        payments: [],
      });

      const file = { fieldname: 'file', originalname: 'bukti.jpg', mimetype: 'image/jpeg', size: 1024, buffer: Buffer.from('x') };
      await service.submitPayment('inv-1', 'TRANSFER', undefined, file, { userId: 'u1', ip: null });

      expect(storage.put).toHaveBeenCalledWith(expect.stringContaining('billing/'), file.buffer, 'image/jpeg');
      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ method: 'TRANSFER', proofKey: expect.any(String) }) }),
      );
    });

    it('file format tidak didukung → 400', async () => {
      prisma.invoice.findUnique.mockResolvedValue(invoiceRow);
      prisma.parentStudentRelation.findFirst.mockResolvedValue({ id: 'r1' });
      const file = { fieldname: 'file', originalname: 'bukti.pdf', mimetype: 'application/pdf', size: 1024, buffer: Buffer.from('x') };
      await expect(
        service.submitPayment('inv-1', 'TRANSFER', undefined, file, { userId: 'u1', ip: null }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('resolveProofDownload', () => {
    it('signature tidak valid → 403', async () => {
      signer.verify.mockReturnValue(false);
      await expect(service.resolveProofDownload('pay-1', 1, 'bad')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('tidak ada proofKey (mis. CASH) → 404', async () => {
      prisma.payment.findUnique.mockResolvedValue({ proofKey: null });
      await expect(service.resolveProofDownload('pay-1', 9999999999, 'sig')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('ada proofKey → ambil buffer dari storage', async () => {
      prisma.payment.findUnique.mockResolvedValue({ proofKey: 'billing/2026/x.png' });
      storage.get.mockResolvedValue(Buffer.from('img'));
      const res = await service.resolveProofDownload('pay-1', 9999999999, 'sig');
      expect(res.contentType).toBe('image/png');
      expect(storage.get).toHaveBeenCalledWith('billing/2026/x.png');
    });
  });
});
