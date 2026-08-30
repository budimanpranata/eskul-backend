import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rate-limit';

export interface RateLimitOptions {
  /** Maksimum request dalam jendela waktu. */
  limit: number;
  /** Panjang jendela (detik). */
  windowSeconds: number;
  /** Label unik untuk namespace counter Redis (mis. 'login'). Default: METHOD:path. */
  scope?: string;
}

/**
 * Membatasi laju request pada sebuah handler (dievaluasi `RateLimitGuard` global).
 * Contoh: `@RateLimit({ limit: 5, windowSeconds: 60, scope: 'login' })`.
 */
export const RateLimit = (opts: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, opts);

/** Menandai handler agar dikecualikan dari batas global (mis. health check). */
export const NO_RATE_LIMIT_KEY = 'rate-limit:skip';
export const NoRateLimit = () => SetMetadata(NO_RATE_LIMIT_KEY, true);
