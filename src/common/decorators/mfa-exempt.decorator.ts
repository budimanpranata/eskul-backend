import { SetMetadata } from '@nestjs/common';

export const MFA_EXEMPT_KEY = 'mfa:exempt';

/**
 * Menandai route agar tetap boleh diakses oleh sesi admin yang MFA-nya masih
 * "pending" (belum setup). Dipakai untuk endpoint setup MFA + profil + logout.
 */
export const MfaExempt = () => SetMetadata(MFA_EXEMPT_KEY, true);
