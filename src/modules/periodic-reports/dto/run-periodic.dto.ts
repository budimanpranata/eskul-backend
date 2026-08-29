import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

/** POST /admin/periodic-reports/run — pemicu manual (ops / uji). */
export class RunPeriodicDto {
  @IsIn(['weekly', 'monthly'])
  type!: 'weekly' | 'monthly';

  /** Lewati run-guard Redis (mis. jalankan ulang periode yang sama). */
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  force?: boolean;
}
