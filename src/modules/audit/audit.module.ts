import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { AuditInterceptor } from '../../common/interceptors/audit.interceptor.js';
import { AuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';

/**
 * Global agar semua modul bisa inject AuditService tanpa import berulang.
 * Menyediakan pula `AuditInterceptor` global (Fase 4.1) yang menulis `audit_logs`
 * otomatis untuk handler ber-`@Audit(...)`.
 */
@Global()
@Module({
  controllers: [AuditController],
  providers: [
    AuditService,
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
  exports: [AuditService],
})
export class AuditModule {}
