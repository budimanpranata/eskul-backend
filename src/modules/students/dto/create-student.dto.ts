import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateStudentDto {
  @IsString()
  @IsNotEmpty({ message: 'NIS wajib diisi.' })
  @MaxLength(30)
  nis!: string;

  @IsString()
  @IsNotEmpty({ message: 'Nama lengkap wajib diisi.' })
  @MaxLength(150)
  fullName!: string;

  /** contoh: "4A" */
  @IsString()
  @IsNotEmpty({ message: 'Kelas wajib diisi.' })
  @MaxLength(20)
  classGrade!: string;

  @IsOptional()
  @IsIn(['L', 'P'], { message: "Jenis kelamin harus 'L' atau 'P'." })
  gender?: 'L' | 'P';

  @IsOptional()
  @IsDateString({}, { message: 'Tanggal lahir harus format tanggal (YYYY-MM-DD).' })
  dateOfBirth?: string;

  @IsOptional()
  @IsString()
  @Type(() => String)
  photoUrl?: string;
}
