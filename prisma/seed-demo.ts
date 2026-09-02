/**
 * Seed data DEMO (opsional) — dataset "mini-sekolah" yang realistis untuk
 * mencoba seluruh alur: pembina, ekskul + jadwal, siswa, keanggotaan,
 * orang tua + relasi (APPROVED / PENDING / REJECTED), dan beberapa sesi
 * presensi tersubmit.
 *
 * Terpisah dari `seed.ts` (yang minimal). Idempoten — aman diulang.
 * Jalankan:  npm run db:seed:demo
 *
 * Kredensial (semua HANYA untuk development):
 *   pembina : <email>            / Pembina#2026
 *   ortu    : ortu.<nama>@ortu.eskul.test / Ortu#2026
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const PW_COACH = 'Pembina#2026';
const PW_PARENT = 'Ortu#2026';

const timeOfDay = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);

/** Tanggal (UTC, tanpa jam) kemunculan ke-`n` terakhir dari `dow` (1=Sen..7=Min). */
function recentWeekday(dow: number, weeksAgo: number): Date {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const cur = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  let back = cur - dow;
  if (back < 0) back += 7;
  d.setUTCDate(d.getUTCDate() - back - weeksAgo * 7);
  return d;
}

// ---------------------------------------------------------------------------
// 1. Pembina
// ---------------------------------------------------------------------------
const COACHES = [
  { key: 'andi',  fullName: 'Andi Wijaya, S.Pd.',      email: 'andi.wijaya@pembina.eskul.test',   phone: '0811200001', spec: 'Olahraga' },
  { key: 'sri',   fullName: 'Sri Lestari, S.Sn.',      email: 'sri.lestari@pembina.eskul.test',    phone: '0811200002', spec: 'Seni Pertunjukan' },
  { key: 'bagus', fullName: 'Bagus Santoso, S.Pd.',    email: 'bagus.santoso@pembina.eskul.test',  phone: '0811200003', spec: 'Kepramukaan' },
  { key: 'dewi',  fullName: 'Dewi Anggraini, S.Sn.',   email: 'dewi.anggraini@pembina.eskul.test', phone: '0811200004', spec: 'Seni Rupa' },
  { key: 'eko',   fullName: 'Eko Prasetyo',            email: 'eko.prasetyo@pembina.eskul.test',   phone: '0811200005', spec: 'Beladiri' },
];

// ---------------------------------------------------------------------------
// 2. Ekskul + jadwal  (coach = key pembina di atas)
// ---------------------------------------------------------------------------
const EKSKUL = [
  { key: 'sepakbola', name: 'Sepak Bola',      category: 'OLAHRAGA', coach: 'andi',  quota: 22,
    schedules: [ { d: 1, s: '15:30', e: '17:00', loc: 'Lapangan Utama' }, { d: 4, s: '15:30', e: '17:00', loc: 'Lapangan Utama' } ] },
  { key: 'futsal',    name: 'Futsal',          category: 'OLAHRAGA', coach: 'andi',  quota: 16,
    schedules: [ { d: 3, s: '15:30', e: '16:30', loc: 'GOR Indoor' } ] },
  { key: 'tari',      name: 'Tari Tradisional', category: 'SENI',    coach: 'sri',   quota: 20,
    schedules: [ { d: 2, s: '14:00', e: '15:30', loc: 'Aula Barat' } ] },
  { key: 'suara',     name: 'Paduan Suara',    category: 'SENI',     coach: 'sri',   quota: 30,
    schedules: [ { d: 5, s: '13:00', e: '14:00', loc: 'Ruang Musik' } ] },
  { key: 'pramuka',   name: 'Pramuka',         category: 'NON_AKADEMIK', coach: 'bagus', quota: 40,
    schedules: [ { d: 6, s: '07:30', e: '10:00', loc: 'Lapangan Utama' } ] },
  { key: 'melukis',   name: 'Melukis',         category: 'SENI',     coach: 'dewi',  quota: 18,
    schedules: [ { d: 4, s: '14:00', e: '15:00', loc: 'Ruang Seni' } ] },
  { key: 'karate',    name: 'Karate',          category: 'OLAHRAGA', coach: 'eko',   quota: 24,
    schedules: [ { d: 2, s: '16:00', e: '17:30', loc: 'Aula Timur' }, { d: 5, s: '16:00', e: '17:30', loc: 'Aula Timur' } ] },
];

// ---------------------------------------------------------------------------
// 3. Siswa  (+ ekskul yang diikuti, + orang tua)
//    parent.status: 'APPROVED' | 'PENDING' | 'REJECTED' | null (tanpa ortu)
// ---------------------------------------------------------------------------
const STUDENTS = [
  { nis: '2026040001', name: 'Budi Hartono',       cls: '4A', g: 'L', ek: ['sepakbola', 'pramuka'],  parent: { name: 'Hartono Susilo',      rel: 'AYAH', status: 'APPROVED' } },
  { nis: '2026040002', name: 'Siti Nurhaliza',     cls: '4A', g: 'P', ek: ['tari', 'suara'],         parent: { name: 'Rina Wulandari',      rel: 'IBU',  status: 'APPROVED' } },
  { nis: '2026040003', name: 'Rizky Ramadhan',     cls: '4B', g: 'L', ek: ['sepakbola', 'karate'],   parent: { name: 'Agus Ramadhan',       rel: 'AYAH', status: 'APPROVED' } },
  { nis: '2026040004', name: 'Putri Maharani',     cls: '4B', g: 'P', ek: ['tari'],                  parent: { name: 'Endang Maharani',     rel: 'IBU',  status: 'APPROVED' } },
  { nis: '2026050005', name: 'Ahmad Fauzi',        cls: '5A', g: 'L', ek: ['futsal', 'pramuka'],     parent: { name: 'Fauzan Abdullah',     rel: 'AYAH', status: 'APPROVED' } },
  { nis: '2026050006', name: 'Nabila Az-Zahra',    cls: '5A', g: 'P', ek: ['suara', 'melukis'],      parent: { name: 'Dewi Sartika',        rel: 'IBU',  status: 'APPROVED' } },
  { nis: '2026050007', name: 'Dimas Pratama',      cls: '5B', g: 'L', ek: ['sepakbola'],             parent: { name: 'Bambang Pratama',     rel: 'AYAH', status: 'APPROVED' } },
  { nis: '2026050008', name: 'Aisyah Kirana',      cls: '5B', g: 'P', ek: ['tari', 'melukis'],       parent: { name: 'Kartika Sari',        rel: 'IBU',  status: 'APPROVED' } },
  { nis: '2026030009', name: 'Fajar Nugroho',      cls: '3A', g: 'L', ek: ['pramuka'],               parent: { name: 'Sutrisno Nugroho',    rel: 'AYAH', status: 'APPROVED' } },
  { nis: '2026030010', name: 'Kayla Ashira',       cls: '3A', g: 'P', ek: ['melukis'],               parent: { name: 'Maya Ashira',         rel: 'IBU',  status: 'APPROVED' } },
  { nis: '2026060011', name: 'Bagas Saputra',      cls: '6A', g: 'L', ek: ['futsal', 'karate'],      parent: { name: 'Joko Saputra',        rel: 'AYAH', status: 'APPROVED' } },
  { nis: '2026060012', name: 'Zahra Kirania',      cls: '6A', g: 'P', ek: ['suara'],                 parent: { name: 'Lisa Kirania',        rel: 'IBU',  status: 'APPROVED' } },
  { nis: '2026060013', name: 'Yoga Firmansyah',    cls: '6B', g: 'L', ek: ['sepakbola', 'pramuka'],  parent: { name: 'Firman Hidayat',      rel: 'AYAH', status: 'PENDING' } },
  { nis: '2026060014', name: 'Salsabila Putri',    cls: '6B', g: 'P', ek: ['tari'],                  parent: { name: 'Ratna Puspita',       rel: 'IBU',  status: 'PENDING' } },
  { nis: '2026040015', name: 'Rafi Abdillah',      cls: '4A', g: 'L', ek: ['karate'],                parent: { name: 'Abdillah Rahman',     rel: 'AYAH', status: 'PENDING' } },
  { nis: '2026050016', name: 'Alya Ramadhani',     cls: '5A', g: 'P', ek: ['melukis', 'suara'],      parent: { name: 'Sinta Ramadhani',     rel: 'IBU',  status: 'REJECTED' } },
  { nis: '2026030017', name: 'Gilang Permana',     cls: '3B', g: 'L', ek: ['pramuka'],               parent: null },
  { nis: '2026060018', name: 'Intan Permatasari',  cls: '6B', g: 'P', ek: ['tari', 'suara'],         parent: null },
];

const slug = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');

async function upsertUser(
  roleCode: string,
  u: { fullName: string; email: string; phone: string; password: string },
) {
  const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
  const passwordHash = await argon2.hash(u.password, { type: argon2.argon2id });
  return prisma.user.upsert({
    where: { email: u.email },
    update: { roleId: role.id, fullName: u.fullName, phoneNumber: u.phone, isActive: true },
    create: {
      roleId: role.id, fullName: u.fullName, email: u.email,
      phoneNumber: u.phone, passwordHash, isActive: true,
    },
  });
}

async function main() {
  const admin = await prisma.user.findUnique({ where: { email: 'admin@eskul.test' } });
  const approvedBy = admin?.id ?? null;

  // -- Pembina + Coach --
  const coachId: Record<string, string> = {};
  for (const c of COACHES) {
    const user = await upsertUser('PEMBINA', { fullName: c.fullName, email: c.email, phone: c.phone, password: PW_COACH });
    const coach = await prisma.coach.upsert({
      where: { userId: user.id },
      update: { specialization: c.spec },
      create: { userId: user.id, specialization: c.spec },
    });
    coachId[c.key] = coach.id;
  }

  // -- Ekskul + jadwal --
  const ekId: Record<string, string> = {};
  const ekSchedule: Record<string, { id: string; d: number; s: string; e: string; loc: string }[]> = {};
  for (const ek of EKSKUL) {
    let row = await prisma.extracurricular.findFirst({ where: { name: ek.name } });
    row ??= await prisma.extracurricular.create({
      data: { name: ek.name, category: ek.category, maxCapacity: ek.quota, defaultCoachId: coachId[ek.coach] },
    });
    if (row.defaultCoachId !== coachId[ek.coach] || !row.isActive) {
      row = await prisma.extracurricular.update({
        where: { id: row.id }, data: { defaultCoachId: coachId[ek.coach], isActive: true },
      });
    }
    ekId[ek.key] = row.id;
    ekSchedule[ek.key] = [];
    for (const sc of ek.schedules) {
      const found = await prisma.extracurricularSchedule.findFirst({
        where: { extracurricularId: row.id, dayOfWeek: sc.d },
      });
      const s = found ?? (await prisma.extracurricularSchedule.create({
        data: {
          extracurricularId: row.id, dayOfWeek: sc.d,
          startTime: timeOfDay(sc.s), endTime: timeOfDay(sc.e), location: sc.loc,
        },
      }));
      ekSchedule[ek.key].push({ id: s.id, d: sc.d, s: sc.s, e: sc.e, loc: sc.loc });
    }
  }

  // -- Siswa + keanggotaan + orang tua + relasi --
  const studentId: Record<string, string> = {};
  const membersByEk: Record<string, string[]> = {};
  let approved = 0, pending = 0, rejected = 0;

  for (const st of STUDENTS) {
    const s = await prisma.student.upsert({
      where: { nis: st.nis },
      update: { fullName: st.name, classGrade: st.cls, gender: st.g, isActive: true },
      create: {
        nis: st.nis, fullName: st.name, classGrade: st.cls, gender: st.g,
        qrToken: `demo-qr-${st.nis}`, isActive: true,
      },
    });
    studentId[st.nis] = s.id;

    for (const ekKey of st.ek) {
      await prisma.extracurricularMember.upsert({
        where: { extracurricularId_studentId: { extracurricularId: ekId[ekKey], studentId: s.id } },
        update: { status: 'ACTIVE' },
        create: { extracurricularId: ekId[ekKey], studentId: s.id, status: 'ACTIVE' },
      });
      (membersByEk[ekKey] ??= []).push(s.id);
    }

    if (st.parent) {
      const pu = await upsertUser('ORANGTUA', {
        fullName: st.parent.name,
        email: `ortu.${slug(st.name)}@ortu.eskul.test`,
        phone: `08122${st.nis.slice(-6)}`,
        password: PW_PARENT,
      });
      const parent = await prisma.parent.upsert({
        where: { userId: pu.id },
        update: { relationType: st.parent.rel, identityVerified: st.parent.status === 'APPROVED' },
        create: { userId: pu.id, relationType: st.parent.rel, identityVerified: st.parent.status === 'APPROVED' },
      });

      const decided = st.parent.status !== 'PENDING';
      await prisma.parentStudentRelation.upsert({
        where: { parentId_studentId: { parentId: parent.id, studentId: s.id } },
        update: {
          approvalStatus: st.parent.status,
          approvedBy: decided ? approvedBy : null,
          approvedAt: decided ? new Date(Date.now() - 3 * 864e5) : null, // 3 hari lalu (lewat cooldown)
        },
        create: {
          parentId: parent.id, studentId: s.id, isPrimaryContact: true,
          approvalStatus: st.parent.status,
          approvedBy: decided ? approvedBy : null,
          approvedAt: decided ? new Date(Date.now() - 3 * 864e5) : null,
        },
      });
      if (st.parent.status === 'APPROVED') approved++;
      else if (st.parent.status === 'PENDING') pending++;
      else rejected++;
    }
  }

  // -- Presensi: 3 sesi terakhir untuk beberapa ekskul --
  const SESSION_PLAN = [
    { ek: 'sepakbola', material: 'Passing bawah & kontrol bola.', target: 'Akurasi umpan pendek.' },
    { ek: 'tari',      material: 'Ragam gerak tari saman dasar.', target: 'Sinkronisasi tepukan.' },
    { ek: 'pramuka',   material: 'Simpul dasar & sandi morse.',   target: 'Hafal 5 simpul.' },
  ];
  const STATUS_CYCLE = ['HADIR', 'HADIR', 'HADIR', 'IZIN', 'HADIR', 'SAKIT', 'HADIR', 'HADIR'];
  let sessionCount = 0, detailCount = 0;

  for (const plan of SESSION_PLAN) {
    const ek = EKSKUL.find((e) => e.key === plan.ek)!;
    const sc = ekSchedule[plan.ek][0];
    const cId = coachId[ek.coach];
    const roster = membersByEk[plan.ek] ?? [];
    for (let w = 1; w <= 3; w++) {
      const sessionDate = recentWeekday(sc.d, w);
      const session = await prisma.attendanceSession.upsert({
        where: {
          extracurricularId_sessionDate_coachId: {
            extracurricularId: ekId[plan.ek], sessionDate, coachId: cId,
          },
        },
        update: { status: 'SUBMITTED' },
        create: {
          extracurricularId: ekId[plan.ek], coachId: cId, scheduleId: sc.id, sessionDate,
          startTime: timeOfDay(sc.s), endTime: timeOfDay(sc.e), location: sc.loc,
          materialDescription: plan.material, durationMinutes: 90,
          targetAchievement: plan.target, status: 'SUBMITTED', submittedAt: new Date(),
        },
      });
      sessionCount++;
      for (let i = 0; i < roster.length; i++) {
        const status = STATUS_CYCLE[(i + w) % STATUS_CYCLE.length];
        const isHadir = status === 'HADIR';
        await prisma.attendanceDetail.upsert({
          where: { sessionId_studentId: { sessionId: session.id, studentId: roster[i] } },
          update: { status },
          create: {
            sessionId: session.id, studentId: roster[i], status,
            activenessScore: isHadir ? 3 + ((i + w) % 3) : null,
            skillNotes: isHadir && i % 3 === 0 ? 'Perkembangan baik minggu ini.' : null,
            personalNotes: status === 'SAKIT' ? 'Izin sakit, ada surat dari orang tua.' : null,
          },
        });
        detailCount++;
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `Seed DEMO selesai.\n` +
      `  Pembina : ${COACHES.length}  (password: ${PW_COACH})\n` +
      `  Ekskul  : ${EKSKUL.length}  |  Siswa: ${STUDENTS.length}\n` +
      `  Relasi ortu : ${approved} APPROVED, ${pending} PENDING, ${rejected} REJECTED  (password: ${PW_PARENT})\n` +
      `  Presensi    : ${sessionCount} sesi, ${detailCount} baris detail\n` +
      `  Contoh login pembina : ${COACHES[0].email}\n` +
      `  Contoh login ortu    : ortu.${slug(STUDENTS[0].name)}@ortu.eskul.test`,
  );
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
