/**
 * Nama properti yang benar-benar berisi nilai (bukan `undefined`).
 *
 * class-transformer membuat properti `undefined` untuk setiap field yang
 * dideklarasikan di DTO (useDefineForClassFields), jadi `Object.keys(dto)` saja
 * akan mencantumkan field yang tidak dikirim klien. Dipakai untuk metadata audit.
 */
export function definedKeys(obj: Record<string, unknown>): string[] {
  return Object.keys(obj).filter((k) => obj[k] !== undefined);
}
