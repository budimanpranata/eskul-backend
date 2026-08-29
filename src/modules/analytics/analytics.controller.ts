import { Controller, Get, Query } from '@nestjs/common';

import { Audit } from '../../common/decorators/audit.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { AnalyticsService } from './analytics.service.js';

/**
 * Dashboard Analitik Sekolah (dokumen desain 5.3). Fase 3.2.
 * Data agregat di-cache Redis TTL 1 jam; `?fresh=1` melewati cache.
 * Audit ditulis otomatis oleh `AuditInterceptor` (Fase 4.1).
 */
@Roles('ADMIN')
@Controller('admin/analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  @Audit({ action: 'VIEW_ANALYTICS_OVERVIEW', entityType: 'analytics', captureQuery: ['fresh'] })
  overview(@Query('fresh') fresh: string | undefined) {
    return this.analytics.overview({ fresh: fresh === '1' || fresh === 'true' });
  }
}
