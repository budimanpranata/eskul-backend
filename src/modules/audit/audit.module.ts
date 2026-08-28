import { Global, Module } from '@nestjs/common';
import { AuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';

/**
 * Global agar semua modul bisa inject AuditService tanpa import berulang.
 * (Pencatatan / review audit log data sensitif — Fase 1.1 / 4.1.)
 */
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
