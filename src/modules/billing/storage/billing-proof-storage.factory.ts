import { ConfigService } from '@nestjs/config';

import { LocalDiskReportStorage } from '../../reports/storage/local-disk-storage.js';
import type { ReportStorage } from '../../reports/storage/report-storage.js';

/** Token DI terpisah dari `REPORT_STORAGE` — modul berbeda, direktori berbeda. */
export const BILLING_PROOF_STORAGE = Symbol('BILLING_PROOF_STORAGE');

/**
 * Penyimpanan gambar bukti transfer — pakai implementasi disk lokal yang sama
 * dengan file export laporan (`ReportStorage`/`LocalDiskReportStorage` generik,
 * tidak spesifik ke laporan), direktori terpisah.
 */
export function billingProofStorageFactory(config: ConfigService): ReportStorage {
  const dir = config.get<string>('billing.proofStorageDir') ?? './storage/billing-proofs';
  return new LocalDiskReportStorage(dir);
}
