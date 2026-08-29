import { Controller, Get, Query } from '@nestjs/common';

import { Roles } from '../../common/decorators/roles.decorator.js';
import { AuditQueryDto } from './dto/audit-query.dto.js';
import { AuditService } from './audit.service.js';

/**
 * Review audit log akses data sensitif (Fase 4.1).
 * Read-only, khusus role **ADMIN_SUPER** (sub-permission — bukan semua admin).
 */
@Roles('ADMIN_SUPER')
@Controller('admin/audit-logs')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  list(@Query() query: AuditQueryDto) {
    return this.auditService.query(query);
  }

  @Get('facets')
  facets() {
    return this.auditService.facets();
  }
}
