import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { LocalDiskReportStorage } from './local-disk-storage.js';
import type { ReportStorage } from './report-storage.js';

/**
 * Memilih implementasi `ReportStorage`.
 *
 * Saat ini hanya driver disk lokal yang dibundel. Bila kredensial S3 terisi kita
 * tetap memakai disk lokal tapi memberi peringatan — driver S3 (mis. berbasis
 * `@aws-sdk/client-s3`) bisa ditambahkan sebagai implementasi lain dari interface
 * `ReportStorage` lalu dipilih di sini.
 */
export function reportStorageFactory(config: ConfigService): ReportStorage {
  const logger = new Logger('ReportStorageFactory');
  const dir = config.get<string>('reports.storageDir') ?? './storage/reports';

  if (config.get<string>('storage.accessKey')) {
    logger.warn(
      'Kredensial S3 terdeteksi, tetapi driver object storage belum dibundel — memakai disk lokal.',
    );
  }
  return new LocalDiskReportStorage(dir);
}
