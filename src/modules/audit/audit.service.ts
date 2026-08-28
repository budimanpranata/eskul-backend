import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service.js';

export interface AuditEntry {
  /** UUID user pelaku aksi. null bila aktor tak dikenal (mis. login gagal identifier salah). */
  userId?: string | null;
  action: string; // 'LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT', 'TOKEN_REFRESH', ...
  entityType: string; // 'user', 'attendance_session', ...
  entityId?: string | null;
  ipAddress?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Pencatatan audit log ke tabel `audit_logs` (dokumen desain bagian 7.3).
 *
 * FASE 1.1: menyediakan `log()` yang dipakai modul auth.
 * FASE 4.1: akan dilengkapi interceptor global untuk semua akses data siswa.
 *
 * Kegagalan menulis audit TIDAK boleh menggagalkan request utama — hanya di-log.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: entry.userId ?? null,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          ipAddress: entry.ipAddress ?? null,
          metadata: entry.metadata,
        },
      });
    } catch (err) {
      this.logger.error(
        `Gagal menulis audit log (action=${entry.action}): ${(err as Error).message}`,
      );
    }
  }
}
