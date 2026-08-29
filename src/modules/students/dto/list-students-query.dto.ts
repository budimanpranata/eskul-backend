import { Transform } from 'class-transformer';
import { IsBooleanString, IsOptional, IsString, MaxLength } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';

export class ListStudentsQueryDto extends PaginationQueryDto {
  /** Cari pada NIS atau nama (case-insensitive, contains). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  classGrade?: string;

  /** 'true' | 'false' — filter status aktif. Default: semua. */
  @IsOptional()
  @IsBooleanString()
  @Transform(({ value }) => value)
  isActive?: string;
}
