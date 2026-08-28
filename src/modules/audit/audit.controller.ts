import { Controller } from '@nestjs/common';
import { AuditService } from './audit.service.js';

/**
 * Pencatatan & review audit log akses data sensitif. Fase 1.1 / 4.1.
 * FASE 0: kerangka controller — route ditambahkan pada fase terkait.
 */
@Controller('admin/audit-logs')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}
}
