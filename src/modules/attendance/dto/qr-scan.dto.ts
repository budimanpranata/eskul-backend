import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

/** POST /coach/students/qr-scan — resolusi qr_token hasil scan → student. */
export class QrScanDto {
  @IsString()
  @IsNotEmpty({ message: 'qr_token wajib diisi.' })
  @MaxLength(64)
  qr_token!: string;

  @IsUUID('4')
  extracurricular_id!: string;
}
