import { IsBooleanString, IsOptional, IsString, MaxLength } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';

export class ListCoachesQueryDto extends PaginationQueryDto {
  /** Cari pada nama, email, atau nomor pegawai. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsBooleanString()
  isActive?: string;
}
