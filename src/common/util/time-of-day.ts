/**
 * Utilitas konversi jam "HH:mm" <-> Date untuk kolom PostgreSQL `TIME`.
 * Prisma memetakan `@db.Time` ke `Date` (dengan bagian tanggal 1970-01-01 UTC).
 */

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidHHmm(value: string): boolean {
  return HHMM.test(value);
}

/** "15:30" -> Date(1970-01-01T15:30:00.000Z) */
export function parseTimeOfDay(value: string): Date {
  if (!HHMM.test(value)) {
    throw new Error(`Format jam tidak valid: "${value}" (harus HH:mm).`);
  }
  return new Date(`1970-01-01T${value}:00.000Z`);
}

/** Date -> "15:30" (memakai komponen UTC). */
export function formatTimeOfDay(date: Date): string {
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** Menit sejak tengah malam, untuk perbandingan overlap. */
export function minutesOfDay(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}
