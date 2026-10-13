import { IsOptional, IsString, MaxLength } from 'class-validator';

/** PUT /admin/settings/branding (multipart — field `logo` opsional/gambar). */
export class UpdateBrandingDto {
  /** String kosong = reset ke default ('Eskul'). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  appName?: string;
}
