import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Kontrak `POST /attendance/submit` — dokumen desain bagian 4.1.
 * Nama field sengaja snake_case agar identik dengan kontrak API.
 */

export class MaterialDto {
  @IsString()
  @MaxLength(2000)
  description!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(600)
  duration_minutes?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  target_achievement?: string;
}

export class AttendanceItemDto {
  @IsUUID('4')
  student_id!: string;

  @IsIn(['HADIR', 'IZIN', 'SAKIT', 'ALPA'], {
    message: 'Status harus salah satu dari HADIR, IZIN, SAKIT, ALPA',
  })
  status!: 'HADIR' | 'IZIN' | 'SAKIT' | 'ALPA';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  activeness_score?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  skill_notes?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  personal_notes?: string | null;
}

export class SubmitAttendanceDto {
  /** UUID v4 dibuat di sisi mobile saat draft pertama kali dibuka (idempotency key). */
  @IsUUID('4')
  client_generated_id!: string;

  @IsUUID('4')
  extracurricular_id!: string;

  @IsOptional()
  @IsUUID('4')
  schedule_id?: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'session_date harus format YYYY-MM-DD.' })
  session_date!: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'start_time harus HH:mm.' })
  start_time?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'end_time harus HH:mm.' })
  end_time?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  location?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => MaterialDto)
  material?: MaterialDto;

  @IsArray()
  @ArrayMinSize(1, { message: 'Minimal satu siswa pada daftar presensi.' })
  @ValidateNested({ each: true })
  @Type(() => AttendanceItemDto)
  attendances!: AttendanceItemDto[];
}
