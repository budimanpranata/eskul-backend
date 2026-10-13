import { ConfigService } from '@nestjs/config';

import { LocalDiskReportStorage } from '../../reports/storage/local-disk-storage.js';
import type { ReportStorage } from '../../reports/storage/report-storage.js';

/** Token DI terpisah — direktori berbeda dari REPORT_STORAGE / BILLING_PROOF_STORAGE. */
export const BRANDING_LOGO_STORAGE = Symbol('BRANDING_LOGO_STORAGE');

/** Penyimpanan logo aplikasi — pakai implementasi disk lokal generik yang sama. */
export function brandingLogoStorageFactory(config: ConfigService): ReportStorage {
  const dir = config.get<string>('branding.logoStorageDir') ?? './storage/branding';
  return new LocalDiskReportStorage(dir);
}
