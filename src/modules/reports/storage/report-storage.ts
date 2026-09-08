/**
 * Abstraksi penyimpanan file hasil export.
 *
 * Dokumen desain: object storage S3-compatible (MinIO on-prem / cloud S3).
 * Implementasi default di dev = `LocalDiskReportStorage`. Driver S3 tinggal
 * dipasang sebagai implementasi lain dari interface ini tanpa mengubah service.
 */
export const REPORT_STORAGE = Symbol('REPORT_STORAGE');

export interface ReportStorage {
  /** Simpan file. `key` = path logis, mis. `attendance/2026/<uuid>.pdf`. */
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  /** Ambil isi file. Melempar bila tidak ada. */
  get(key: string): Promise<Buffer>;
  /** Hapus file (best-effort; tidak melempar bila sudah tidak ada). */
  remove(key: string): Promise<void>;
}
