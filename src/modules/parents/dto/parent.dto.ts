import { Type } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';

/** GET /admin/parent-relations?status=&page=&pageSize= */
export class ListRelationsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['PENDING', 'APPROVED', 'REJECTED'])
  status: 'PENDING' | 'APPROVED' | 'REJECTED' = 'PENDING';
}

/** POST /parent/link-request — ajukan relasi ke seorang siswa (butuh approval admin). */
export class LinkRequestDto {
  @IsString()
  @IsNotEmpty({ message: 'NIS wajib diisi.' })
  @MaxLength(30)
  nis!: string;

  /** Nama siswa untuk verifikasi silang ringan (mengurangi salah klaim). */
  @IsString()
  @IsNotEmpty({ message: 'Nama siswa wajib diisi.' })
  @MaxLength(150)
  studentName!: string;

  @IsOptional()
  @IsIn(['AYAH', 'IBU', 'WALI'])
  relationType?: 'AYAH' | 'IBU' | 'WALI';
}

/** GET /parent/child-progress/:id */
export class ChildProgressQueryDto {
  @IsOptional()
  @IsIn(['weekly', 'monthly'])
  period: 'weekly' | 'monthly' = 'weekly';

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from harus YYYY-MM-DD.' })
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to harus YYYY-MM-DD.' })
  to?: string;

  @IsOptional()
  @IsUUID('4')
  extracurricularId?: string;
}

/** PUT /admin/parent-relations/:id/approve */
export class ApproveRelationDto {
  @Type(() => String)
  @IsIn(['APPROVED', 'REJECTED'], { message: "decision harus 'APPROVED' atau 'REJECTED'." })
  decision!: 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
