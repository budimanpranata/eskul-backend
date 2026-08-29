import { randomBytes } from 'node:crypto';

/**
 * Token acak untuk QR kartu siswa.
 *
 * Sengaja BUKAN turunan dari NIS (dokumen desain bagian 3 & 7.2) — kartu yang
 * hilang tidak membocorkan identitas administratif siswa. Panjang 43 char
 * (base64url dari 32 byte), muat di kolom VARCHAR(64) dan dapat dirotasi (Fase 2.2).
 */
export function generateQrToken(): string {
  return randomBytes(32).toString('base64url');
}
