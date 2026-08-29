import { Body, Controller, Ip, Post } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { AuditService } from '../audit/audit.service.js';
import { RunPeriodicDto } from './dto/run-periodic.dto.js';
import { PeriodicReportsService } from './periodic-reports.service.js';

/**
 * Pemicu manual laporan berkala (Fase 3.3). Jadwal normal berjalan otomatis via
 * `@Cron` di service; endpoint ini untuk ops (mis. re-run periode yang gagal) & uji.
 */
@Roles('ADMIN')
@Controller('admin/periodic-reports')
export class PeriodicReportsController {
  constructor(
    private readonly periodic: PeriodicReportsService,
    private readonly audit: AuditService,
  ) {}

  @Post('run')
  async run(
    @Body() dto: RunPeriodicDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    const result = await this.periodic.run(dto.type, new Date(), { force: dto.force });
    void this.audit.log({
      userId: user.id,
      action: 'RUN_PERIODIC_REPORT',
      entityType: 'periodic_report',
      ipAddress: ip ?? null,
      metadata: { type: dto.type, force: !!dto.force, key: result.key, skipped: !!result.skipped },
    });
    return result;
  }
}
