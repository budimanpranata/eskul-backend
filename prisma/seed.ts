/**
 * Seed data untuk development.
 *
 * Isi:
 *  1. Tiga role wajib sesuai DDL: ADMIN, PEMBINA, ORANGTUA.
 *  2. Satu akun admin dummy untuk keperluan development/login awal.
 *
 * Idempoten — aman dijalankan berulang (pakai upsert).
 * Jalankan: `npm run db:seed`  (atau otomatis oleh `prisma migrate reset`).
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const ROLES = [
  { code: 'ADMIN', name: 'Administrator Sekolah' },
  { code: 'PEMBINA', name: 'Guru Pembina/Pelatih' },
  { code: 'ORANGTUA', name: 'Orang Tua/Wali' },
] as const;

// Kredensial dummy — HANYA untuk development. Ganti/hapus di lingkungan nyata.
const DUMMY_ADMIN = {
  fullName: 'Admin Sekolah (Dummy)',
  email: 'admin@eskul.test',
  phoneNumber: '0800000000001',
  password: 'Admin#12345',
};

async function main() {
  // 1. Roles
  for (const role of ROLES) {
    await prisma.role.upsert({
      where: { code: role.code },
      update: { name: role.name },
      create: role,
    });
  }
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN' } });

  // 2. Admin dummy
  const passwordHash = await argon2.hash(DUMMY_ADMIN.password, { type: argon2.argon2id });
  await prisma.user.upsert({
    where: { email: DUMMY_ADMIN.email },
    update: {},
    create: {
      roleId: adminRole.id,
      fullName: DUMMY_ADMIN.fullName,
      email: DUMMY_ADMIN.email,
      phoneNumber: DUMMY_ADMIN.phoneNumber,
      passwordHash,
      isActive: true,
    },
  });

  // eslint-disable-next-line no-console
  console.log(
    `Seed selesai. Roles: ${ROLES.map((r) => r.code).join(', ')}. ` +
      `Admin dummy: ${DUMMY_ADMIN.email} / ${DUMMY_ADMIN.password}`,
  );
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
