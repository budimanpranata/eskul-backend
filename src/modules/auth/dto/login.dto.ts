import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  /** Email atau nomor HP terdaftar. */
  @IsString()
  @IsNotEmpty({ message: 'Email/No. HP wajib diisi.' })
  @MaxLength(150)
  identifier!: string;

  @IsString()
  @IsNotEmpty({ message: 'Password wajib diisi.' })
  @MaxLength(200)
  password!: string;
}
