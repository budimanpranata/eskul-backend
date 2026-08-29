import { IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** GET /admin/audit-logs — filter review audit (Fase 4.1). */
export class AuditQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  action?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  entityType?: string;

  @IsOptional()
  @IsUUID()
  entityId?: string;

  @IsOptional()
  @Matches(DATE_RE, { message: 'dateFrom harus YYYY-MM-DD.' })
  dateFrom?: string;

  @IsOptional()
  @Matches(DATE_RE, { message: 'dateTo harus YYYY-MM-DD.' })
  dateTo?: string;

  /** Pencarian bebas: action / metadata (JSONB) / nama & email user. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;
}
