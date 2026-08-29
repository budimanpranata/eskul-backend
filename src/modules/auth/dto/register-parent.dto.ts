import { Equals, IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Pendaftaran mandiri akun Orang Tua (dokumen desain bagian 5.2 & OT-01).
 * `consent` wajib true — persetujuan pengumpulan & penggunaan data anak (bagian 7.2).
 */
export class RegisterParentDto {
  @IsString()
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

  @IsIn(['AYAH', 'IBU', 'WALI'], { message: "relationType harus 'AYAH', 'IBU', atau 'WALI'." })
  relationType!: 'AYAH' | 'IBU' | 'WALI';

  @IsBoolean()
  @Equals(true, { message: 'Persetujuan penggunaan data anak wajib dicentang.' })
  consent!: boolean;
}
