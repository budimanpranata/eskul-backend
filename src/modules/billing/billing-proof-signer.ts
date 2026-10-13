import { createHmac, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Menandatangani URL untuk melihat bukti transfer dengan HMAC-SHA256 + waktu
 * kedaluwarsa — pola yang sama dengan `ReportSigner` (Fase 3.1), dipakai
 * terpisah karena path & secret-nya berbeda (bukti pembayaran, bukan laporan).
 * Route lihat bukti bersifat `@Public()`; otorisasinya murni dari signature ini.
 */
@Injectable()
export class BillingProofSigner {
  private readonly secret: string;
  private readonly ttlSeconds: number;

  constructor(config: ConfigService) {
    this.secret =
      config.get<string>('billing.proofSigningSecret') ?? 'insecure-dev-billing-proof-signing-secret';
    this.ttlSeconds = config.get<number>('billing.proofSignedUrlTtlSeconds') ?? 3600;
  }

  buildProofPath(paymentId: string, now: Date = new Date()): { path: string; expiresAt: Date } {
    const expiresAt = new Date(now.getTime() + this.ttlSeconds * 1000);
    const expires = Math.floor(expiresAt.getTime() / 1000);
    const sig = this.computeSig(paymentId, expires);
    return {
      path: `/billing/payments/${paymentId}/proof?expires=${expires}&sig=${sig}`,
      expiresAt,
    };
  }

  verify(paymentId: string, expires: number, sig: string, now: Date = new Date()): boolean {
    if (!Number.isFinite(expires) || expires * 1000 < now.getTime()) return false;
    const expected = this.computeSig(paymentId, expires);
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private computeSig(paymentId: string, expires: number): string {
    return createHmac('sha256', this.secret)
      .update(`${paymentId}.${expires}`)
      .digest('base64url');
  }
}
