/**
 * Seed data untuk development.
 *
 * Isi:
 *  1. Empat role wajib: ADMIN_SUPER, ADMIN, PEMBINA, ORANGTUA.
 *  2. Akun admin dummy (ADMIN + ADMIN_SUPER) untuk login awal.
 *  3. Fixture demo end-to-end: 1 Pembina + 1 Orang Tua + 2 siswa + 1 ekskul
 *     (Futsal) + jadwal + keanggotaan + relasi ortu-siswa APPROVED + 1 sesi
 *     presensi tersubmit. Cukup untuk langsung mencoba mode Pembina & Orang Tua.
 *
 * Idempoten — aman dijalankan berulang (pakai upsert / findFirst+create).
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

// Kredensial dummy Pembina & Orang Tua — HANYA untuk development.
const DUMMY_COACH = {
  fullName: 'Pembina Contoh (Dummy)',
  email: 'pembina@eskul.test',
  phoneNumber: '0800000000010',
  password: 'Pembina#12345',
  employeeNumber: 'EMP-DUMMY-01',
  specialization: 'Umum',
};

const DUMMY_PARENT = {
  fullName: 'Orang Tua Contoh (Dummy)',
  email: 'ortu@eskul.test',
  phoneNumber: '0800000000020',
  password: 'Ortu#12345',
  relationType: 'IBU',
};

const DUMMY_STUDENTS = [
  { nis: '0010001001', fullName: 'Budi Siswa Contoh', classGrade: '4A', gender: 'L', qrToken: 'seed-qr-budi-0010001001' },
  { nis: '0010001002', fullName: 'Siti Siswa Contoh', classGrade: '4A', gender: 'P', qrToken: 'seed-qr-siti-0010001002' },
];

const DUMMY_EKSKUL = {
  name: 'Futsal (Dummy)',
  category: 'OLAHRAGA',
  description: 'Ekskul demo hasil seeder.',
  maxCapacity: 20,
  schedules: [
    { dayOfWeek: 1, startTime: '15:00', endTime: '16:30', location: 'Lapangan Futsal' },
    { dayOfWeek: 4, startTime: '15:00', endTime: '16:30', location: 'Lapangan Futsal' },
  ],
};

/** Kolom `time` disimpan sebagai DateTime pada tanggal epoch (konvensi proyek). */
const timeOfDay = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);

/** Tanggal (tanpa jam) Senin terakhir pada/atau sebelum hari ini — UTC. */
function lastMonday(): Date {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const iso = d.getUTCDay() === 0 ? 7 : d.getUTCDay(); // 1..7
  d.setUTCDate(d.getUTCDate() - (iso - 1));
  return d;
}

async function seedRolesAndAdmins() {
  for (const role of ROLES) {
    await prisma.role.upsert({ where: { code: role.code }, update: { name: role.name }, create: role });
  }
  for (const admin of DUMMY_ADMINS) {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: admin.roleCode } });
    const passwordHash = await argon2.hash(admin.password, { type: argon2.argon2id });
    await prisma.user.upsert({
      where: { email: admin.email },
      update: { roleId: role.id },
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
}

async function upsertUser(roleCode: string, u: { fullName: string; email: string; phoneNumber: string; password: string }) {
  const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
  const passwordHash = await argon2.hash(u.password, { type: argon2.argon2id });
  return prisma.user.upsert({
    where: { email: u.email },
    update: { roleId: role.id, fullName: u.fullName, phoneNumber: u.phoneNumber, isActive: true },
    create: {
      roleId: role.id,
      fullName: u.fullName,
      email: u.email,
      phoneNumber: u.phoneNumber,
      passwordHash,
      isActive: true,
    },
  });
}

async function seedDemoFixture() {
  // --- Pembina + profil Coach ---
  const coachUser = await upsertUser('PEMBINA', DUMMY_COACH);
  const coach = await prisma.coach.upsert({
    where: { userId: coachUser.id },
    update: { specialization: DUMMY_COACH.specialization },
    create: {
      userId: coachUser.id,
      employeeNumber: DUMMY_COACH.employeeNumber,
      specialization: DUMMY_COACH.specialization,
    },
  });

  // --- Orang Tua + profil Parent ---
  const parentUser = await upsertUser('ORANGTUA', DUMMY_PARENT);
  const parent = await prisma.parent.upsert({
    where: { userId: parentUser.id },
    update: { relationType: DUMMY_PARENT.relationType, identityVerified: true },
    create: { userId: parentUser.id, relationType: DUMMY_PARENT.relationType, identityVerified: true },
  });

  // --- Siswa ---
  const students = [];
  for (const s of DUMMY_STUDENTS) {
    students.push(
      await prisma.student.upsert({
        where: { nis: s.nis },
        update: { fullName: s.fullName, classGrade: s.classGrade, gender: s.gender, isActive: true },
        create: { ...s, isActive: true },
      }),
    );
  }

  // --- Ekskul (tanpa unique alami → findFirst + create) ---
  let ekskul = await prisma.extracurricular.findFirst({ where: { name: DUMMY_EKSKUL.name } });
  ekskul ??= await prisma.extracurricular.create({
    data: {
      name: DUMMY_EKSKUL.name,
      category: DUMMY_EKSKUL.category,
      description: DUMMY_EKSKUL.description,
      maxCapacity: DUMMY_EKSKUL.maxCapacity,
      defaultCoachId: coach.id,
    },
  });
  if (ekskul.defaultCoachId !== coach.id || !ekskul.isActive) {
    ekskul = await prisma.extracurricular.update({
      where: { id: ekskul.id },
      data: { defaultCoachId: coach.id, isActive: true },
    });
  }

  // --- Jadwal ---
  const scheduleByDay = new Map<number, string>();
  for (const sc of DUMMY_EKSKUL.schedules) {
    const existing = await prisma.extracurricularSchedule.findFirst({
      where: { extracurricularId: ekskul.id, dayOfWeek: sc.dayOfWeek },
    });
    const row =
      existing ??
      (await prisma.extracurricularSchedule.create({
        data: {
          extracurricularId: ekskul.id,
          dayOfWeek: sc.dayOfWeek,
          startTime: timeOfDay(sc.startTime),
          endTime: timeOfDay(sc.endTime),
          location: sc.location,
        },
      }));
    scheduleByDay.set(sc.dayOfWeek, row.id);
  }

  // --- Keanggotaan (kedua siswa) ---
  for (const st of students) {
    await prisma.extracurricularMember.upsert({
      where: { extracurricularId_studentId: { extracurricularId: ekskul.id, studentId: st.id } },
      update: { status: 'ACTIVE' },
      create: { extracurricularId: ekskul.id, studentId: st.id, status: 'ACTIVE' },
    });
  }

  // --- Relasi ortu → siswa pertama (APPROVED oleh admin) ---
  const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@eskul.test' } });
  await prisma.parentStudentRelation.upsert({
    where: { parentId_studentId: { parentId: parent.id, studentId: students[0].id } },
    update: { approvalStatus: 'APPROVED', approvedBy: adminUser.id },
    create: {
      parentId: parent.id,
      studentId: students[0].id,
      isPrimaryContact: true,
      approvalStatus: 'APPROVED',
      approvedBy: adminUser.id,
      approvedAt: new Date(),
    },
  });

  // --- Satu sesi presensi tersubmit (Senin terakhir) untuk data progress ---
  const sessionDate = lastMonday();
  const session = await prisma.attendanceSession.upsert({
    where: {
      extracurricularId_sessionDate_coachId: {
        extracurricularId: ekskul.id,
        sessionDate,
        coachId: coach.id,
      },
    },
    update: { status: 'SUBMITTED' },
    create: {
      extracurricularId: ekskul.id,
      coachId: coach.id,
      scheduleId: scheduleByDay.get(1) ?? null,
      sessionDate,
      startTime: timeOfDay('15:00'),
      endTime: timeOfDay('16:30'),
      location: 'Lapangan Futsal',
      materialDescription: 'Latihan dasar: passing bawah & dribbling.',
      durationMinutes: 90,
      targetAchievement: 'Menguasai passing bawah jarak pendek.',
      status: 'SUBMITTED',
      submittedAt: new Date(),
    },
  });

  const detailSeed = [
    { studentId: students[0].id, status: 'HADIR', activenessScore: 4, skillNotes: 'Passing membaik, perlu latihan kontrol.' },
    { studentId: students[1].id, status: 'HADIR', activenessScore: 5, skillNotes: 'Sangat aktif, dribbling stabil.' },
  ];
  for (const d of detailSeed) {
    await prisma.attendanceDetail.upsert({
      where: { sessionId_studentId: { sessionId: session.id, studentId: d.studentId } },
      update: { status: d.status, activenessScore: d.activenessScore, skillNotes: d.skillNotes },
      create: { sessionId: session.id, ...d },
    });
  }

  return { ekskul, sessionDate };
}

async function main() {
  await seedRolesAndAdmins();
  const { sessionDate } = await seedDemoFixture();

  const creds = [
    ...DUMMY_ADMINS.map((a) => `${a.email} / ${a.password}`),
    `${DUMMY_COACH.email} / ${DUMMY_COACH.password}  (PEMBINA)`,
    `${DUMMY_PARENT.email} / ${DUMMY_PARENT.password}  (ORANGTUA — anak: ${DUMMY_STUDENTS[0].fullName})`,
  ];
  // eslint-disable-next-line no-console
  console.log(
    `Seed selesai.\n  Roles : ${ROLES.map((r) => r.code).join(', ')}\n` +
      `  Akun  :\n    - ${creds.join('\n    - ')}\n` +
      `  Demo  : ekskul "${DUMMY_EKSKUL.name}", ${DUMMY_STUDENTS.length} siswa, ` +
      `1 sesi presensi tersubmit (${sessionDate.toISOString().slice(0, 10)}).`,
  );
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
