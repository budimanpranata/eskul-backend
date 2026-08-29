import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

/** Update profil pembina. Password TIDAK diubah lewat sini (reset password terpisah). */
export class UpdateCoachDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  fullName?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Email tidak valid.' })
  @MaxLength(150)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  employeeNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  specialization?: string;

  @IsOptional()
  @IsString()
  bio?: string;
}
