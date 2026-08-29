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
  { code: 'ADMIN_SUPER', name: 'Administrator Super (akses audit log)' },
  { code: 'ADMIN', name: 'Administrator Sekolah' },
  { code: 'PEMBINA', name: 'Guru Pembina/Pelatih' },
  { code: 'ORANGTUA', name: 'Orang Tua/Wali' },
] as const;

// Kredensial dummy — HANYA untuk development. Ganti/hapus di lingkungan nyata.
const DUMMY_ADMINS = [
  {
    roleCode: 'ADMIN',
    fullName: 'Admin Sekolah (Dummy)',
    email: 'admin@eskul.test',
    phoneNumber: '0800000000001',
    password: 'Admin#12345',
  },
  {
    // Bisa melihat halaman Audit Log (sub-permission ADMIN_SUPER — Fase 4.1).
    roleCode: 'ADMIN_SUPER',
    fullName: 'Super Admin (Dummy)',
    email: 'superadmin@eskul.test',
    phoneNumber: '0800000000000',
    password: 'Super#12345',
  },
] as const;

async function main() {
  // 1. Roles
  for (const role of ROLES) {
    await prisma.role.upsert({
      where: { code: role.code },
      update: { name: role.name },
      create: role,
    });
  }
  // 2. Admin dummy (ADMIN + ADMIN_SUPER)
  for (const admin of DUMMY_ADMINS) {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: admin.roleCode } });
    const passwordHash = await argon2.hash(admin.password, { type: argon2.argon2id });
    await prisma.user.upsert({
      where: { email: admin.email },
      update: { roleId: role.id }, // pastikan role sinkron bila seed lama sudah ada
      create: {
        roleId: role.id,
        fullName: admin.fullName,
        email: admin.email,
        phoneNumber: admin.phoneNumber,
        passwordHash,
        isActive: true,
      },
    });
  }

  // eslint-disable-next-line no-console
  console.log(
    `Seed selesai. Roles: ${ROLES.map((r) => r.code).join(', ')}. ` +
      DUMMY_ADMINS.map((a) => `${a.email} / ${a.password}`).join('  |  '),
  );
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
