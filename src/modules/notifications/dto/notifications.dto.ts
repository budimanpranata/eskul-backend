import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';

export class RegisterDeviceDto {
  @IsString()
  @IsNotEmpty({ message: 'token wajib diisi.' })
  @MaxLength(4096)
  token!: string;

  @IsOptional()
  @IsIn(['android', 'ios'])
  platform?: 'android' | 'ios';
}

export class UnregisterDeviceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  token!: string;
}

export class ListNotificationsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  unreadOnly?: boolean;
}

export class MarkReadDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  ids!: string[];
}
