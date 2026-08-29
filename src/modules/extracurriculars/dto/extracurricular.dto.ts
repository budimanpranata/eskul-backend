import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
  IsBooleanString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  MaxLength,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';

export class CreateExtracurricularDto {
  @IsString()
  @IsNotEmpty({ message: 'Nama ekskul wajib diisi.' })
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID('4', { message: 'defaultCoachId harus UUID.' })
  defaultCoachId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxCapacity?: number;
}

export class UpdateExtracurricularDto extends PartialType(CreateExtracurricularDto) {}

export class ListExtracurricularsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;

  @IsOptional()
  @IsBooleanString()
  isActive?: string;
}

export class CreateScheduleDto {
  /** 1=Senin ... 7=Minggu (dokumen desain: day_of_week CHECK BETWEEN 1 AND 7). */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek!: number;

  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'startTime harus format HH:mm.' })
  startTime!: string;

  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'endTime harus format HH:mm.' })
  endTime!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  location?: string;
}

export class UpdateScheduleDto extends PartialType(CreateScheduleDto) {}

export class AddMembersDto {
  @IsUUID('4', { each: true, message: 'Setiap studentId harus UUID v4.' })
  studentIds!: string[];
}
