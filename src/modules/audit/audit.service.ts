import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  buildPageMeta,
  pageSkip,
  type PaginatedResult,
} from '../../common/dto/pagination.dto.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuditQueryDto } from './dto/audit-query.dto.js';

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

  // ---------- review (Fase 4.1) ----------

  /**
   * GET /admin/audit-logs — pencarian ber-filter. Query mentah agar bisa
   * memanfaatkan index (`idx_audit_created/action/entity`) dan GIN trigram
   * `idx_audit_metadata_trgm` untuk free-text di `metadata::text`.
   */
  async query(f: AuditQueryDto): Promise<PaginatedResult<unknown>> {
    const conds: Prisma.Sql[] = [];
    if (f.userId) conds.push(Prisma.sql`al.user_id = ${f.userId}::uuid`);
    if (f.action) conds.push(Prisma.sql`al.action = ${f.action}`);
    if (f.entityType) conds.push(Prisma.sql`al.entity_type = ${f.entityType}`);
    if (f.entityId) conds.push(Prisma.sql`al.entity_id = ${f.entityId}::uuid`);
    if (f.dateFrom) conds.push(Prisma.sql`al.created_at >= ${`${f.dateFrom}T00:00:00Z`}::timestamptz`);
    if (f.dateTo) conds.push(Prisma.sql`al.created_at < (${f.dateTo}::date + interval '1 day')`);
    if (f.q) {
      const like = `%${f.q}%`;
      conds.push(
        Prisma.sql`(al.action ILIKE ${like} OR al.metadata::text ILIKE ${like} OR u.full_name ILIKE ${like} OR u.email ILIKE ${like})`,
      );
    }
    const whereSql = conds.length
      ? Prisma.sql`WHERE ${Prisma.join(conds, ' AND ')}`
      : Prisma.empty;

    const take = f.pageSize;
    const skip = pageSkip(f.page, f.pageSize);

    const [rows, totals] = await Promise.all([
      this.prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT al.id::text AS id, al.user_id AS "userId",
               u.full_name AS "userName", u.email AS "userEmail",
               al.action, al.entity_type AS "entityType", al.entity_id AS "entityId",
               al.ip_address::text AS "ipAddress", al.metadata, al.created_at AS "createdAt"
        FROM audit_logs al
        LEFT JOIN users u ON u.id = al.user_id
        ${whereSql}
        ORDER BY al.created_at DESC, al.id DESC
        LIMIT ${take} OFFSET ${skip}`,
      this.prisma.$queryRaw<{ total: number }[]>`
        SELECT count(*)::int AS total
        FROM audit_logs al
        LEFT JOIN users u ON u.id = al.user_id
        ${whereSql}`,
    ]);

    return { data: rows, meta: buildPageMeta(f.page, f.pageSize, totals[0]?.total ?? 0) };
  }

  /** Nilai unik untuk dropdown filter di halaman review. */
  async facets(): Promise<{ actions: string[]; entityTypes: string[] }> {
    const [a, e] = await Promise.all([
      this.prisma.$queryRaw<{ action: string }[]>`SELECT DISTINCT action FROM audit_logs ORDER BY action`,
      this.prisma.$queryRaw<
        { entity_type: string }[]
      >`SELECT DISTINCT entity_type FROM audit_logs ORDER BY entity_type`,
    ]);
    return { actions: a.map((r) => r.action), entityTypes: e.map((r) => r.entity_type) };
  }
}
