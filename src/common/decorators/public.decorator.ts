import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Menandai route agar dilewati oleh JwtAuthGuard global.
 * Dipakai untuk endpoint yang memang publik: /auth/login, /auth/refresh, /health.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
