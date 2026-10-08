import {
  IsBoolean,
  IsBooleanString,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';

/** POST /admin/schools — dibuat ADMIN_SUPER: sekolah + admin pertamanya (satu transaksi). */
export class CreateSchoolDto {
  /** Kode unik, dipakai juga oleh ortu saat `POST /parent/link-request`. */
  @IsString()
  @IsNotEmpty({ message: 'Kode sekolah wajib diisi.' })
  @Matches(/^[A-Za-z0-9._-]+$/, { message: 'Kode hanya boleh huruf/angka/._- (tanpa spasi).' })
  @MaxLength(30)
  code!: string;

  @IsString()
  @IsNotEmpty({ message: 'Nama sekolah wajib diisi.' })
  @MaxLength(150)
  name!: string;

  @IsString()
  @IsNotEmpty({ message: 'Nama admin wajib diisi.' })
  @MaxLength(150)
  adminFullName!: string;

  @IsEmail({}, { message: 'Email admin tidak valid.' })
  @MaxLength(150)
  adminEmail!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  adminPhoneNumber?: string;

  @IsString()
  @MinLength(8, { message: 'Password minimal 8 karakter.' })
  @MaxLength(200)
  adminPassword!: string;
}

/** PUT /admin/schools/:id */
export class UpdateSchoolDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** POST /admin/schools/:id/admins — tambah admin lain ke sekolah yang sudah ada. */
export class CreateSchoolAdminDto {
  @IsString()
  @IsNotEmpty({ message: 'Nama lengkap wajib diisi.' })
  @MaxLength(150)
  fullName!: string;

  @IsEmail({}, { message: 'Email tidak valid.' })
  @MaxLength(150)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phoneNumber?: string;

  @IsString()
  @MinLength(8, { message: 'Password minimal 8 karakter.' })
  @MaxLength(200)
  password!: string;
}

export class ListSchoolsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsBooleanString()
  isActive?: string;
}
