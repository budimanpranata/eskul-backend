/**
 * Seeder per-sekolah — Model 1 (satu deployment per sekolah).
 *
 * Membuat 4 role wajib + SATU akun ADMIN sekolah dari environment.
 * Idempoten. TIDAK memuat data demo.
 *
 * Dipakai oleh `scripts/provision-school.sh` setelah `prisma migrate deploy`
 * pada database sekolah yang baru dibuat (`DATABASE_URL` menunjuk ke DB itu).
 *
 * Env:
 *   SCHOOL_ADMIN_EMAIL     (wajib)
 *   SCHOOL_ADMIN_NAME      (wajib)
 *   SCHOOL_ADMIN_PASSWORD  (opsional — bila kosong: di-generate & dicetak di output JSON)
 *   SCHOOL_ADMIN_PHONE     (opsional)
 */
import { randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const ROLES = [
  { code: 'ADMIN_SUPER', name: 'Administrator Super (akses audit log)' },
  { code: 'ADMIN', name: 'Administrator Sekolah' },
  { code: 'PEMBINA', name: 'Guru Pembina/Pelatih' },
  { code: 'ORANGTUA', name: 'Orang Tua/Wali' },
] as const;

function reqEnv(key: string): string {
  const v = process.env[key]?.trim();
  if (!v) {
    // eslint-disable-next-line no-console
    console.error(`FATAL: environment ${key} wajib diisi.`);
    process.exit(2);
  }
  return v;
}

async function main() {
  const email = reqEnv('SCHOOL_ADMIN_EMAIL').toLowerCase();
  const fullName = reqEnv('SCHOOL_ADMIN_NAME');
  const phoneNumber = process.env.SCHOOL_ADMIN_PHONE?.trim() || null;

  let password = process.env.SCHOOL_ADMIN_PASSWORD?.trim();
  const generated = !password;
  if (!password) password = randomBytes(12).toString('base64url'); // ~16 char

  for (const role of ROLES) {
    await prisma.role.upsert({
      where: { code: role.code },
      update: { name: role.name },
      create: role,
    });
  }

  const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN' } });
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  const user = await prisma.user.upsert({
    where: { email },
    update: { roleId: adminRole.id, fullName, phoneNumber, isActive: true },
    create: { roleId: adminRole.id, fullName, email, phoneNumber, passwordHash, isActive: true },
  });

  // Output JSON di satu baris — di-parse oleh skrip provisioning.
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      ok: true,
      adminUserId: user.id,
      adminEmail: email,
      rolesEnsured: ROLES.map((r) => r.code),
      ...(generated ? { generatedPassword: password } : {}),
    }),
  );
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
