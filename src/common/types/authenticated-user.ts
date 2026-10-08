/**
 * Kode role sesuai tabel `roles`.
 * `ADMIN_SUPER` = admin dengan sub-permission penuh (mis. lihat audit log — Fase 4.1);
 * mewarisi seluruh hak `ADMIN` (lihat `roleSatisfies`).
 */
export type RoleCode = 'ADMIN_SUPER' | 'ADMIN' | 'PEMBINA' | 'ORANGTUA';

/** Hierarki role: ADMIN_SUPER memenuhi kebutuhan role ADMIN. */
export function roleSatisfies(userRole: RoleCode, required: RoleCode): boolean {
  if (userRole === required) return true;
  return userRole === 'ADMIN_SUPER' && required === 'ADMIN';
}

export const ADMIN_ROLES: RoleCode[] = ['ADMIN', 'ADMIN_SUPER'];
export const isAdminRole = (role: RoleCode): boolean => ADMIN_ROLES.includes(role);

/** Payload di dalam JWT access token. */
export interface AccessTokenPayload {
  sub: string; // user id (UUID)
  role: RoleCode;
  type: 'access';
  /** true bila admin ini belum mengaktifkan MFA → akses dibatasi (Fase 4.2). */
  mfaPending?: true;
  /**
   * Tenant (sekolah) pemilik akun ini — hanya terisi untuk ADMIN/PEMBINA.
   * `null`/absen untuk ORANGTUA (isolasi lewat relasi per-siswa) dan
   * ADMIN_SUPER (operator platform, lintas-sekolah). Klaim `sch` (Fase multi-tenant).
   */
  sch?: string | null;
}

/** Payload di dalam JWT refresh token. */
export interface RefreshTokenPayload {
  sub: string; // user id (UUID)
  jti: string; // id sesi refresh, dipakai untuk revocation di Redis
  type: 'refresh';
}

/** Token tantangan sesaat antara langkah password & langkah TOTP (Fase 4.2). */
export interface MfaChallengeTokenPayload {
  sub: string; // user id (UUID)
  type: 'mfa_challenge';
}

/** Objek user yang ditempel ke `request.user` setelah JwtAuthGuard lolos. */
export interface AuthenticatedUser {
  id: string;
  role: RoleCode;
  /** true → sesi ini hanya boleh mengakses endpoint setup MFA. */
  mfaPending?: boolean;
  /** Tenant (sekolah) pemilik akun; `null` untuk ORANGTUA & ADMIN_SUPER. */
  schoolId: string | null;
}

/**
 * UUID yang sengaja tidak pernah dipakai sekolah mana pun — dipakai sebagai
 * filter "tidak cocok apa pun" (fail-closed) bila akun ADMIN/PEMBINA entah
 * bagaimana tidak punya `school_id` (seharusnya tidak terjadi setelah
 * migrasi; ini jaring pengaman, bukan jalur normal).
 */
export const NO_MATCH_SCHOOL_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Filter `school_id` yang konsisten untuk query Prisma scoped-tenant:
 * `undefined` (tanpa filter, lintas-sekolah) HANYA untuk ADMIN_SUPER — ini
 * operator platform by design, bukan bug. Untuk role lain selalu nilai eksak
 * `user.schoolId`, atau `NO_MATCH_SCHOOL_ID` (fail-closed, cocok dengan
 * NOTHING) bila entah bagaimana kosong.
 */
export function tenantScope(user: AuthenticatedUser): string | undefined {
  return user.role === 'ADMIN_SUPER' ? undefined : (user.schoolId ?? NO_MATCH_SCHOOL_ID);
}
