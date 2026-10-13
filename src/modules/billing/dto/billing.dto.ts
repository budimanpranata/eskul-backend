import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';

const PERIOD_PATTERN = /^[A-Za-z0-9._-]{1,20}$/;

/** POST /admin/billing/invoices/generate — bikin tagihan massal untuk siswa yang cocok filter. */
export class GenerateInvoicesDto {
  /** Bebas, biasanya 'YYYY-MM' (bulan), tapi bisa label termin lain. */
  @IsString()
  @Matches(PERIOD_PATTERN, { message: 'period hanya boleh huruf/angka/._- (maks 20 karakter).' })
  period!: string;

  @IsString()
  @IsNotEmpty({ message: 'Judul tagihan wajib diisi.' })
  @MaxLength(150)
  title!: string;

  @Type(() => Number)
  @IsInt()
  @IsPositive({ message: 'Nominal harus lebih dari 0.' })
  amount!: number;

  /** Bila diisi: hanya siswa aktif anggota ekskul ini. Bila kosong: tagihan umum per siswa. */
  @IsOptional()
  @IsUUID('4')
  extracurricularId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  classGrade?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dueDate harus YYYY-MM-DD.' })
  dueDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

/** POST /admin/billing/invoices — tagihan satuan (ad-hoc) untuk satu siswa. */
export class CreateInvoiceDto {
  @IsUUID('4')
  studentId!: string;

  @IsOptional()
  @IsUUID('4')
  extracurricularId?: string;

  @IsString()
  @Matches(PERIOD_PATTERN, { message: 'period hanya boleh huruf/angka/._- (maks 20 karakter).' })
  period!: string;

  @IsString()
  @IsNotEmpty({ message: 'Judul tagihan wajib diisi.' })
  @MaxLength(150)
  title!: string;

  @Type(() => Number)
  @IsInt()
  @IsPositive({ message: 'Nominal harus lebih dari 0.' })
  amount!: number;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dueDate harus YYYY-MM-DD.' })
  dueDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

const INVOICE_STATUSES = ['UNPAID', 'PENDING_VERIFICATION', 'PAID', 'CANCELLED'] as const;

/** GET /admin/billing/invoices */
export class ListInvoicesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(INVOICE_STATUSES)
  status?: (typeof INVOICE_STATUSES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(20)
  period?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  classGrade?: string;

  @IsOptional()
  @IsUUID('4')
  extracurricularId?: string;

  @IsOptional()
  @IsUUID('4')
  studentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

/** GET /admin/billing/report */
export class BillingReportQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  period?: string;

  @IsOptional()
  @IsUUID('4')
  extracurricularId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  classGrade?: string;
}

/** GET /admin/billing/payments */
export class ListPaymentsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['PENDING', 'APPROVED', 'REJECTED'])
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';
}

/** PUT /admin/billing/payments/:id/verify */
export class VerifyPaymentDto {
  @IsIn(['APPROVED', 'REJECTED'], { message: "decision harus 'APPROVED' atau 'REJECTED'." })
  decision!: 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/** POST /parent/billing/invoices/:id/pay (multipart — `file` opsional/wajib bila TRANSFER) */
export class SubmitPaymentDto {
  @IsIn(['TRANSFER', 'CASH'], { message: "method harus 'TRANSFER' atau 'CASH'." })
  method!: 'TRANSFER' | 'CASH';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** GET /parent/billing/invoices?studentId= */
export class ParentInvoicesQueryDto {
  @IsUUID('4')
  studentId!: string;

  @IsOptional()
  @IsIn(INVOICE_STATUSES)
  status?: (typeof INVOICE_STATUSES)[number];
}
