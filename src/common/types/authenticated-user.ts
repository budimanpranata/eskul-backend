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

/** Payload di dalam JWT access token. */
export interface AccessTokenPayload {
  sub: string; // user id (UUID)
  role: RoleCode;
  type: 'access';
}

/** Payload di dalam JWT refresh token. */
export interface RefreshTokenPayload {
  sub: string; // user id (UUID)
  jti: string; // id sesi refresh, dipakai untuk revocation di Redis
  type: 'refresh';
}

/** Objek user yang ditempel ke `request.user` setelah JwtAuthGuard lolos. */
export interface AuthenticatedUser {
  id: string;
  role: RoleCode;
}
