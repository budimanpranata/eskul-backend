import { SetMetadata } from '@nestjs/common';

export const AUDIT_KEY = 'audit:meta';

export interface AuditMeta {
  /** mis. 'VIEW_STUDENT_DATA', 'LIST_STUDENTS'. */
  action: string;
  /** mis. 'student', 'parent_relation', 'report', 'analytics'. */
  entityType: string;
  /**
   * Nama route-param yang berisi id entitas (mis. `'id'` untuk `/admin/students/:id`).
   * Nilai diambil dari `req.params[entityIdParam]` bila valid UUID.
   */
  entityIdParam?: string;
  /**
   * Nama key dari `req.params` / `req.query` yang di-snapshot ke `metadata`
   * (mis. filter pencarian). Body TIDAK di-snapshot otomatis (bisa berisi rahasia).
   */
  captureParams?: string[];
  captureQuery?: string[];
  /** Catat juga percobaan yang gagal (4xx/5xx) dengan `outcome:'error'`. Default: true. */
  logFailures?: boolean;
}

/**
 * Menandai handler agar `AuditInterceptor` global menulis satu baris `audit_logs`
 * secara otomatis — tanpa memanggil `AuditService.log()` manual di controller.
 * (Fase 4.1 — audit lengkap berbasis metadata route.)
 */
export const Audit = (meta: AuditMeta) => SetMetadata(AUDIT_KEY, meta);
