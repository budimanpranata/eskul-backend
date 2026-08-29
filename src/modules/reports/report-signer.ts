import { createHmac, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Menandatangani URL unduhan file export dengan HMAC-SHA256 + waktu kedaluwarsa.
 *
 * File hasil export TIDAK bisa diakses tanpa signature yang valid & belum lewat
 * `expires` (DoD Fase 3.1). Route unduhan bersifat `@Public()` — otorisasinya
 * murni dari signature ini, bukan JWT, supaya link bisa dibuka langsung.
 */
@Injectable()
export class ReportSigner {
  private readonly secret: string;
  private readonly ttlSeconds: number;

  constructor(config: ConfigService) {
    this.secret =
      config.get<string>('reports.signingSecret') ?? 'insecure-dev-report-signing-secret';
    this.ttlSeconds = config.get<number>('reports.signedUrlTtlSeconds') ?? 3600;
  }

  /** Path relatif (di bawah global prefix) berisi query `expires` + `sig`. */
  buildDownloadPath(exportId: string, now: Date = new Date()): { path: string; expiresAt: Date } {
    const expiresAt = new Date(now.getTime() + this.ttlSeconds * 1000);
    const expires = Math.floor(expiresAt.getTime() / 1000);
    const sig = this.computeSig(exportId, expires);
    return {
      path: `/admin/reports/downloads/${exportId}?expires=${expires}&sig=${sig}`,
      expiresAt,
    };
  }

  /** true bila signature cocok DAN belum kedaluwarsa. */
  verify(exportId: string, expires: number, sig: string, now: Date = new Date()): boolean {
    if (!Number.isFinite(expires) || expires * 1000 < now.getTime()) return false;
    const expected = this.computeSig(exportId, expires);
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private computeSig(exportId: string, expires: number): string {
    return createHmac('sha256', this.secret)
      .update(`${exportId}.${expires}`)
      .digest('base64url');
  }
}
