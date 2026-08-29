import { Controller, Get, Ip, Query } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { AuditService } from '../audit/audit.service.js';
import { AnalyticsService } from './analytics.service.js';

/**
 * Dashboard Analitik Sekolah (dokumen desain 5.3). Fase 3.2.
 * Data agregat di-cache Redis TTL 1 jam; `?fresh=1` melewati cache.
 */
@Roles('ADMIN')
@Controller('admin/analytics')
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly audit: AuditService,
  ) {}

  @Get('overview')
  async overview(
    @Query('fresh') fresh: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    const result = await this.analytics.overview({ fresh: fresh === '1' || fresh === 'true' });
    void this.audit.log({
      userId: user.id,
      action: 'VIEW_ANALYTICS_OVERVIEW',
      entityType: 'analytics',
      ipAddress: ip ?? null,
      metadata: { cached: result.cached },
    });
    return result;
  }
}
