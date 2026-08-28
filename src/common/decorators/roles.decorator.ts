import { SetMetadata } from '@nestjs/common';
import type { RoleCode } from '../types/authenticated-user.js';

export const ROLES_KEY = 'roles';

/**
 * Membatasi akses route ke role tertentu (dicek oleh RolesGuard global).
 *
 * Contoh: `@Roles('ADMIN')` atau `@Roles('PEMBINA', 'ADMIN')`.
 * Tanpa decorator ini, route hanya butuh autentikasi (bukan role spesifik).
 */
export const Roles = (...roles: RoleCode[]) => SetMetadata(ROLES_KEY, roles);
