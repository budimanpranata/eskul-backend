import { IsIn, IsOptional, IsUUID, Matches, MaxLength } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Filter bersama untuk preview & export laporan kehadiran (dokumen desain 4 / 5.3). */
export class ReportFilterDto {
  @IsOptional()
  @MaxLength(20)
  classGrade?: string;

  @IsOptional()
  @IsUUID()
  extracurricularId?: string;

  @IsOptional()
  @Matches(DATE_RE, { message: 'dateFrom harus format YYYY-MM-DD.' })
  dateFrom?: string;

  @IsOptional()
  @Matches(DATE_RE, { message: 'dateTo harus format YYYY-MM-DD.' })
  dateTo?: string;
}

/** Query untuk `GET /admin/reports/attendance/preview` — filter + pagination tabel. */
export class ReportPreviewQueryDto extends PaginationQueryDto {
  @IsOptional()
  @MaxLength(20)
  classGrade?: string;

  @IsOptional()
  @IsUUID()
  extracurricularId?: string;

  @IsOptional()
  @Matches(DATE_RE, { message: 'dateFrom harus format YYYY-MM-DD.' })
  dateFrom?: string;

  @IsOptional()
  @Matches(DATE_RE, { message: 'dateTo harus format YYYY-MM-DD.' })
  dateTo?: string;
}

/** Query untuk `GET /admin/reports/attendance?format=pdf|xlsx` — memicu job export async. */
export class ReportExportQueryDto extends ReportFilterDto {
  @IsIn(['pdf', 'xlsx'], { message: "format harus 'pdf' atau 'xlsx'." })
  format!: 'pdf' | 'xlsx';
}
