import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { buildPageMeta, pageSkip, type PaginatedResult } from '../../common/dto/pagination.dto.js';
import type { UploadedFile } from '../../common/types/uploaded-file.js';
import { BillingProofSigner } from './billing-proof-signer.js';
import type { ReportStorage } from '../reports/storage/report-storage.js';
import { BILLING_PROOF_STORAGE } from './storage/billing-proof-storage.factory.js';
import type {
  BillingReportQueryDto,
  CreateInvoiceDto,
  GenerateInvoicesDto,
  ListInvoicesQueryDto,
  ListPaymentsQueryDto,
  VerifyPaymentDto,
} from './dto/billing.dto.js';

interface Actor {
  id: string;
  ip: string | null;
  /** Hasil `tenantScope(user)` — `undefined` = ADMIN_SUPER (lintas sekolah). */
  schoolId: string | undefined;
}

const MAX_PROOF_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_PROOF_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

const INVOICE_SUMMARY_SELECT = {
  id: true,
  period: true,
  title: true,
  amount: true,
  dueDate: true,
  status: true,
  notes: true,
  createdAt: true,
  student: { select: { id: true, nis: true, fullName: true, classGrade: true } },
  extracurricular: { select: { id: true, name: true } },
  payments: {
    orderBy: { submittedAt: 'desc' as const },
    take: 1,
    select: { id: true, method: true, status: true, submittedAt: true, verifiedAt: true },
  },
} satisfies Prisma.InvoiceSelect;

@Injectable()
export class BillingService {
  private readonly apiPrefix: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly signer: BillingProofSigner,
    private readonly config: ConfigService,
    @Inject(BILLING_PROOF_STORAGE) private readonly storage: ReportStorage,
  ) {
    this.apiPrefix = (this.config.get<string>('apiPrefix') ?? 'api/v1').replace(/^\/|\/$/g, '');
  }

  /** `signer.buildProofPath()` tidak tahu global prefix (`/api/v1`) — tambahkan di sini. */
  private proofUrl(paymentId: string): string {
    return `/${this.apiPrefix}${this.signer.buildProofPath(paymentId).path}`;
  }

  // ================= ADMIN =================

  /** Generate massal — satu invoice per siswa yang cocok filter, idempoten per (siswa, ekskul, period). */
  async generateInvoices(dto: GenerateInvoicesDto, actor: Actor) {
    let ekskulId: string | undefined;
    if (dto.extracurricularId) {
      const ekskul = await this.prisma.extracurricular.findFirst({
        where: { id: dto.extracurricularId, ...this.schoolFilter(actor.schoolId) },
        select: { id: true },
      });
      if (!ekskul) throw new NotFoundException('Ekstrakurikuler tidak ditemukan.');
      ekskulId = ekskul.id;
    }

    const studentIds = ekskulId
      ? (
          await this.prisma.extracurricularMember.findMany({
            where: {
              extracurricularId: ekskulId,
              status: 'ACTIVE',
              student: { isActive: true, ...(dto.classGrade ? { classGrade: dto.classGrade } : {}) },
            },
            select: { studentId: true },
          })
        ).map((m) => m.studentId)
      : (
          await this.prisma.student.findMany({
            where: {
              isActive: true,
              ...(dto.classGrade ? { classGrade: dto.classGrade } : {}),
              ...this.schoolFilter(actor.schoolId),
            },
            select: { id: true },
          })
        ).map((s) => s.id);

    if (studentIds.length === 0) {
      return { created: 0, skipped: 0, totalMatched: 0 };
    }

    // `skipDuplicates` pada UNIQUE(student_id, extracurricular_id, period) TIDAK
    // cukup bila extracurricular_id NULL (tagihan umum) — Postgres menganggap
    // NULL tidak sama dengan NULL pada unique index, jadi re-generate periode
    // yang sama akan membuat duplikat. Filter manual di sini dulu; biarkan
    // `skipDuplicates` hanya sebagai jaring pengaman race-condition.
    const existing = await this.prisma.invoice.findMany({
      where: { studentId: { in: studentIds }, extracurricularId: ekskulId ?? null, period: dto.period },
      select: { studentId: true },
    });
    const existingSet = new Set(existing.map((e) => e.studentId));
    const toCreate = studentIds.filter((id) => !existingSet.has(id));

    const result = toCreate.length
      ? await this.prisma.invoice.createMany({
          data: toCreate.map((studentId) => ({
            studentId,
            extracurricularId: ekskulId ?? null,
            period: dto.period,
            title: dto.title,
            amount: dto.amount,
            dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
            notes: dto.notes ?? null,
            createdById: actor.id,
          })),
          skipDuplicates: true,
        })
      : { count: 0 };

    await this.audit.log({
      userId: actor.id,
      action: 'GENERATE_INVOICES',
      entityType: 'invoice',
      entityId: null,
      ipAddress: actor.ip,
      metadata: {
        period: dto.period,
        title: dto.title,
        amount: dto.amount,
        extracurricularId: ekskulId ?? null,
        classGrade: dto.classGrade ?? null,
        created: result.count,
        skipped: studentIds.length - result.count,
      },
    });

    return { created: result.count, skipped: studentIds.length - result.count, totalMatched: studentIds.length };
  }

  /** Tagihan satuan (ad-hoc) untuk satu siswa. */
  async createInvoice(dto: CreateInvoiceDto, actor: Actor) {
    const student = await this.prisma.student.findFirst({
      where: { id: dto.studentId, ...this.schoolFilter(actor.schoolId) },
      select: { id: true },
    });
    if (!student) throw new NotFoundException('Siswa tidak ditemukan.');

    if (dto.extracurricularId) {
      const ekskul = await this.prisma.extracurricular.findFirst({
        where: { id: dto.extracurricularId, ...this.schoolFilter(actor.schoolId) },
        select: { id: true },
      });
      if (!ekskul) throw new NotFoundException('Ekstrakurikuler tidak ditemukan.');
    }

    // Cek manual (bukan cuma andalkan UNIQUE index) — lihat catatan di
    // `generateInvoices`: NULL extracurricular_id tidak terdeteksi index unik.
    const dup = await this.prisma.invoice.findFirst({
      where: { studentId: dto.studentId, extracurricularId: dto.extracurricularId ?? null, period: dto.period },
      select: { id: true },
    });
    if (dup) throw new ConflictException('Tagihan untuk siswa, ekskul, dan periode ini sudah ada.');

    let invoice;
    try {
      invoice = await this.prisma.invoice.create({
        data: {
          studentId: dto.studentId,
          extracurricularId: dto.extracurricularId ?? null,
          period: dto.period,
          title: dto.title,
          amount: dto.amount,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          notes: dto.notes ?? null,
          createdById: actor.id,
        },
        select: { id: true },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Tagihan untuk siswa, ekskul, dan periode ini sudah ada.');
      }
      throw e;
    }

    await this.audit.log({
      userId: actor.id,
      action: 'CREATE_INVOICE',
      entityType: 'invoice',
      entityId: invoice.id,
      ipAddress: actor.ip,
      metadata: { studentId: dto.studentId, period: dto.period, amount: dto.amount },
    });
    return this.getInvoiceById(invoice.id, actor.schoolId);
  }

  async listInvoices(query: ListInvoicesQueryDto, schoolScope: string | undefined): Promise<PaginatedResult<unknown>> {
    const studentWhere: Prisma.StudentWhereInput = { ...this.schoolFilter(schoolScope) };
    if (query.classGrade) studentWhere.classGrade = query.classGrade;
    if (query.search) {
      studentWhere.OR = [
        { fullName: { contains: query.search, mode: 'insensitive' } },
        { nis: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const where: Prisma.InvoiceWhereInput = { student: studentWhere };
    if (query.status) where.status = query.status;
    if (query.period) where.period = query.period;
    if (query.extracurricularId) where.extracurricularId = query.extracurricularId;
    if (query.studentId) where.studentId = query.studentId;

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.findMany({
        where,
        select: INVOICE_SUMMARY_SELECT,
        orderBy: [{ createdAt: 'desc' }],
        skip: pageSkip(query.page, query.pageSize),
        take: query.pageSize,
      }),
    ]);

    return { data: rows.map(presentInvoiceSummary), meta: buildPageMeta(query.page, query.pageSize, total) };
  }

  async getInvoiceById(id: string, schoolScope: string | undefined) {
    const row = await this.prisma.invoice.findFirst({
      where: { id, student: this.schoolFilter(schoolScope) },
      select: {
        ...INVOICE_SUMMARY_SELECT,
        payments: {
          orderBy: { submittedAt: 'desc' },
          select: {
            id: true,
            method: true,
            amount: true,
            status: true,
            note: true,
            proofKey: true,
            submittedAt: true,
            submittedBy: { select: { fullName: true } },
            verifiedAt: true,
            verifiedBy: { select: { fullName: true } },
            rejectionReason: true,
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Tagihan tidak ditemukan.');
    return {
      ...presentInvoiceSummary(row),
      payments: row.payments.map((p) => ({
        id: p.id,
        method: p.method,
        amount: p.amount,
        status: p.status,
        note: p.note,
        hasProof: !!p.proofKey,
        proofUrl: p.proofKey ? this.proofUrl(p.id) : null,
        submittedAt: p.submittedAt,
        submittedByName: p.submittedBy.fullName,
        verifiedAt: p.verifiedAt,
        verifiedByName: p.verifiedBy?.fullName ?? null,
        rejectionReason: p.rejectionReason,
      })),
    };
  }

  async cancelInvoice(id: string, actor: Actor) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, student: this.schoolFilter(actor.schoolId) },
      select: { id: true, status: true },
    });
    if (!invoice) throw new NotFoundException('Tagihan tidak ditemukan.');
    if (invoice.status !== 'UNPAID') {
      throw new ConflictException(`Tagihan berstatus ${invoice.status} tidak bisa dibatalkan.`);
    }
    await this.prisma.invoice.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.audit.log({
      userId: actor.id,
      action: 'CANCEL_INVOICE',
      entityType: 'invoice',
      entityId: id,
      ipAddress: actor.ip,
    });
    return this.getInvoiceById(id, actor.schoolId);
  }

  /** Rekap siswa sudah/belum bayar — DoD: report siswa belum/sudah bayar. */
  async report(query: BillingReportQueryDto, schoolScope: string | undefined) {
    const studentWhere: Prisma.StudentWhereInput = { ...this.schoolFilter(schoolScope) };
    if (query.classGrade) studentWhere.classGrade = query.classGrade;

    const where: Prisma.InvoiceWhereInput = { student: studentWhere };
    if (query.period) where.period = query.period;
    if (query.extracurricularId) where.extracurricularId = query.extracurricularId;

    const [grouped, total, rows] = await this.prisma.$transaction([
      this.prisma.invoice.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.findMany({
        where,
        select: INVOICE_SUMMARY_SELECT,
        orderBy: [{ student: { classGrade: 'asc' } }, { student: { fullName: 'asc' } }],
        skip: pageSkip(query.page, query.pageSize),
        take: query.pageSize,
      }),
    ]);

    const byStatus = (status: string) => grouped.find((g) => g.status === status);
    const summary = {
      totalInvoices: total,
      totalAmount: grouped.reduce((s, g) => s + (g._sum.amount ?? 0), 0),
      unpaid: { count: byStatus('UNPAID')?._count._all ?? 0, amount: byStatus('UNPAID')?._sum.amount ?? 0 },
      pendingVerification: {
        count: byStatus('PENDING_VERIFICATION')?._count._all ?? 0,
        amount: byStatus('PENDING_VERIFICATION')?._sum.amount ?? 0,
      },
      paid: { count: byStatus('PAID')?._count._all ?? 0, amount: byStatus('PAID')?._sum.amount ?? 0 },
      cancelled: { count: byStatus('CANCELLED')?._count._all ?? 0, amount: byStatus('CANCELLED')?._sum.amount ?? 0 },
    };

    return {
      summary,
      rows: rows.map(presentInvoiceSummary),
      meta: buildPageMeta(query.page, query.pageSize, total),
    };
  }

  // ---- Validasi pembayaran (admin) ----

  async listPayments(query: ListPaymentsQueryDto, schoolScope: string | undefined): Promise<PaginatedResult<unknown>> {
    const where: Prisma.PaymentWhereInput = {
      invoice: { student: this.schoolFilter(schoolScope) },
    };
    if (query.status) where.status = query.status;

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({
        where,
        select: {
          id: true,
          method: true,
          amount: true,
          status: true,
          note: true,
          proofKey: true,
          submittedAt: true,
          submittedBy: { select: { fullName: true } },
          invoice: {
            select: {
              id: true,
              title: true,
              period: true,
              student: { select: { id: true, nis: true, fullName: true, classGrade: true } },
            },
          },
        },
        orderBy: { submittedAt: 'asc' },
        skip: pageSkip(query.page, query.pageSize),
        take: query.pageSize,
      }),
    ]);

    const data = rows.map((p) => ({
      id: p.id,
      method: p.method,
      amount: p.amount,
      status: p.status,
      note: p.note,
      hasProof: !!p.proofKey,
      proofUrl: p.proofKey ? this.proofUrl(p.id) : null,
      submittedAt: p.submittedAt,
      submittedByName: p.submittedBy.fullName,
      invoice: p.invoice,
    }));
    return { data, meta: buildPageMeta(query.page, query.pageSize, total) };
  }

  async verifyPayment(paymentId: string, dto: VerifyPaymentDto, actor: Actor) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, invoice: { student: this.schoolFilter(actor.schoolId) } },
      select: {
        id: true,
        status: true,
        amount: true,
        invoiceId: true,
        submittedById: true,
        invoice: { select: { title: true, studentId: true, student: { select: { fullName: true } } } },
      },
    });
    if (!payment) throw new NotFoundException('Pengajuan pembayaran tidak ditemukan.');
    if (payment.status !== 'PENDING') {
      throw new ConflictException(`Pengajuan ini sudah berstatus ${payment.status}.`);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: dto.decision,
          verifiedById: actor.id,
          verifiedAt: new Date(),
          rejectionReason: dto.decision === 'REJECTED' ? (dto.reason ?? null) : null,
        },
      });
      await tx.invoice.update({
        where: { id: payment.invoiceId },
        data: { status: dto.decision === 'APPROVED' ? 'PAID' : 'UNPAID' },
      });
    });

    await this.audit.log({
      userId: actor.id,
      action: dto.decision === 'APPROVED' ? 'APPROVE_PAYMENT' : 'REJECT_PAYMENT',
      entityType: 'payment',
      entityId: paymentId,
      ipAddress: actor.ip,
      metadata: { invoiceId: payment.invoiceId, reason: dto.reason ?? null },
    });

    const approved = dto.decision === 'APPROVED';
    void this.notifications.enqueueUserNotification({
      userId: payment.submittedById,
      type: 'PAYMENT_DECISION',
      title: approved ? 'Pembayaran tagihan disetujui' : 'Pembayaran tagihan ditolak',
      body: approved
        ? `Pembayaran "${payment.invoice.title}" untuk ${payment.invoice.student.fullName} sudah dikonfirmasi lunas.`
        : `Pembayaran "${payment.invoice.title}" untuk ${payment.invoice.student.fullName} ditolak.` +
          (dto.reason ? ` Alasan: ${dto.reason}` : ''),
      payload: { invoiceId: payment.invoiceId, paymentId, decision: dto.decision },
      jobId: `notify_pay_${paymentId}_${dto.decision}`,
      dedupeKey: `pay:${paymentId}:${dto.decision}`,
    });

    return this.getInvoiceById(payment.invoiceId, actor.schoolId);
  }

  // ================= ORANG TUA =================

  async parentInvoices(studentId: string, status: string | undefined, parentUserId: string) {
    await this.assertApprovedRelation(studentId, parentUserId);
    const where: Prisma.InvoiceWhereInput = { studentId };
    if (status) where.status = status;
    const rows = await this.prisma.invoice.findMany({
      where,
      select: INVOICE_SUMMARY_SELECT,
      orderBy: [{ createdAt: 'desc' }],
    });
    return rows.map(presentInvoiceSummary);
  }

  async parentInvoiceDetail(invoiceId: string, parentUserId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { studentId: true },
    });
    if (!invoice) throw new NotFoundException('Tagihan tidak ditemukan.');
    await this.assertApprovedRelation(invoice.studentId, parentUserId);
    return this.getInvoiceById(invoiceId, undefined);
  }

  /** POST /parent/billing/invoices/:id/pay — ajukan klaim pembayaran (transfer/cash). */
  async submitPayment(
    invoiceId: string,
    method: 'TRANSFER' | 'CASH',
    note: string | undefined,
    file: UploadedFile | undefined,
    actor: { userId: string; ip: string | null },
  ) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, studentId: true, amount: true, status: true },
    });
    if (!invoice) throw new NotFoundException('Tagihan tidak ditemukan.');
    await this.assertApprovedRelation(invoice.studentId, actor.userId);

    if (invoice.status !== 'UNPAID') {
      throw new ConflictException(
        invoice.status === 'PAID'
          ? 'Tagihan ini sudah lunas.'
          : invoice.status === 'PENDING_VERIFICATION'
            ? 'Ada pengajuan pembayaran lain untuk tagihan ini yang masih menunggu verifikasi admin.'
            : 'Tagihan ini sudah dibatalkan.',
      );
    }

    if (method === 'TRANSFER' && !file) {
      throw new BadRequestException('Bukti transfer (gambar) wajib diunggah untuk metode transfer.');
    }

    let proofKey: string | null = null;
    if (file) {
      if (!ALLOWED_PROOF_MIME.has(file.mimetype)) {
        throw new BadRequestException('Format bukti harus JPG/PNG/WebP.');
      }
      if (file.size > MAX_PROOF_SIZE) {
        throw new BadRequestException('Ukuran bukti maksimal 5 MB.');
      }
      proofKey = `billing/${new Date().getUTCFullYear()}/${invoiceId}-${Date.now()}.${extFor(file.mimetype)}`;
      await this.storage.put(proofKey, file.buffer, file.mimetype);
    }

    const payment = await this.prisma.$transaction(async (tx) => {
      const p = await tx.payment.create({
        data: {
          invoiceId,
          method,
          amount: invoice.amount,
          proofKey,
          note: note ?? null,
          submittedById: actor.userId,
        },
        select: { id: true },
      });
      await tx.invoice.update({ where: { id: invoiceId }, data: { status: 'PENDING_VERIFICATION' } });
      return p;
    });

    await this.audit.log({
      userId: actor.userId,
      action: 'SUBMIT_PAYMENT',
      entityType: 'payment',
      entityId: payment.id,
      ipAddress: actor.ip,
      metadata: { invoiceId, method },
    });

    return this.parentInvoiceDetail(invoiceId, actor.userId);
  }

  /** GET /billing/payments/:id/proof — unduh bukti (route @Public, otorisasi via signature). */
  async resolveProofDownload(paymentId: string, expires: number, sig: string) {
    if (!this.signer.verify(paymentId, expires, sig)) {
      throw new ForbiddenException('Tautan bukti pembayaran tidak valid atau kedaluwarsa.');
    }
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId }, select: { proofKey: true } });
    if (!payment?.proofKey) throw new NotFoundException('Bukti pembayaran tidak ditemukan.');
    const buffer = await this.storage.get(payment.proofKey);
    const ext = payment.proofKey.split('.').pop() ?? 'jpg';
    return { buffer, contentType: mimeForExt(ext), fileName: `bukti-transfer.${ext}` };
  }

  // --- helpers ---

  /** Shape sengaja longgar (bukan `Prisma.XWhereInput`) — dipakai di-spread ke where Student MAUPUN Extracurricular. */
  private schoolFilter(schoolScope: string | undefined): { schoolId?: string } {
    return schoolScope !== undefined ? { schoolId: schoolScope } : {};
  }

  private async assertApprovedRelation(studentId: string, parentUserId: string): Promise<void> {
    const relation = await this.prisma.parentStudentRelation.findFirst({
      where: { studentId, approvalStatus: 'APPROVED', parent: { userId: parentUserId } },
      select: { id: true },
    });
    if (!relation) {
      throw new ForbiddenException({
        error: 'UNAUTHORIZED_RELATION',
        message: 'Anda belum terverifikasi sebagai wali sah dari siswa ini.',
      });
    }
  }
}

function presentInvoiceSummary(row: {
  id: string;
  period: string;
  title: string;
  amount: number;
  dueDate: Date | null;
  status: string;
  notes: string | null;
  createdAt: Date;
  student: { id: string; nis: string; fullName: string; classGrade: string };
  extracurricular: { id: string; name: string } | null;
  payments: { id: string; method: string; status: string; submittedAt: Date; verifiedAt: Date | null }[];
}) {
  return {
    id: row.id,
    period: row.period,
    title: row.title,
    amount: row.amount,
    dueDate: row.dueDate,
    status: row.status,
    notes: row.notes,
    createdAt: row.createdAt,
    student: row.student,
    extracurricular: row.extracurricular,
    latestPayment: row.payments[0] ?? null,
  };
}

function extFor(mimetype: string): string {
  if (mimetype === 'image/png') return 'png';
  if (mimetype === 'image/webp') return 'webp';
  return 'jpg';
}

function mimeForExt(ext: string): string {
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}
