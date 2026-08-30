import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Kode dari authenticator (6 digit) atau kode pemulihan. */
export class MfaCodeDto {
  @IsString()
  @IsNotEmpty({ message: 'Kode MFA wajib diisi.' })
  @MaxLength(40)
  code!: string;
}

/** Langkah-2 login: token tantangan + kode. */
export class MfaLoginDto {
  @IsString()
  @IsNotEmpty({ message: 'Token verifikasi MFA wajib diisi.' })
  mfaToken!: string;

  @IsString()
  @IsNotEmpty({ message: 'Kode MFA wajib diisi.' })
  @MaxLength(40)
  code!: string;
}
