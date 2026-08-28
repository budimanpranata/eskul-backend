/** Kode role sesuai tabel `roles` (seed Fase 0.2). */
export type RoleCode = 'ADMIN' | 'PEMBINA' | 'ORANGTUA';

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
