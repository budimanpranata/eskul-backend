import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path';

import { Logger } from '@nestjs/common';

import type { ReportStorage } from './report-storage.js';

/**
 * Penyimpanan file export ke disk lokal. Dipakai bila object storage (S3) belum
 * dikonfigurasi. Cukup untuk dev / deployment single-node on-prem.
 */
export class LocalDiskReportStorage implements ReportStorage {
  private readonly logger = new Logger(LocalDiskReportStorage.name);
  private readonly root: string;

  constructor(dir: string) {
    this.root = isAbsolute(dir) ? dir : resolve(process.cwd(), dir);
    this.logger.log(`File export disimpan ke disk lokal: ${this.root}`);
  }

  async put(key: string, data: Buffer, _contentType: string): Promise<void> {
    const full = this.resolveKey(key);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, data);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolveKey(key));
  }

  async remove(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true });
  }

  /** Cegah path traversal — `key` harus tetap di dalam `root`. */
  private resolveKey(key: string): string {
    const full = normalize(join(this.root, key));
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error(`Key export tidak valid: ${key}`);
    }
    return full;
  }
}
