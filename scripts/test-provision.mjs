/**
 * Test lapisan-data provisioning multi-sekolah (Model 1).
 * Jalankan dari backend/:   node scripts/test-provision.mjs
 *
 * Butuh: container `eskul-postgres` hidup (docker compose dev), tsx & prisma
 * di node_modules. Menguji: buat DB+role per sekolah, `prisma migrate deploy`,
 * seed role+admin, isolasi antar-sekolah, guard duplikat, dan deprovision.
 * Orkestrasi container/nginx dilewati (ESKUL_SKIP_ORCHESTRATION=1) — bagian itu
 * diverifikasi operator di server Ubuntu (lihat scripts/README.md).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';

const PG_CONTAINER = process.env.ESKUL_TEST_PG_CONTAINER || 'eskul-postgres';
const HOST_PORT = process.env.ESKUL_TEST_PG_HOSTPORT || '55432';
const STATE = mkdtempSync(join(tmpdir(), 'eskul-prov-'));

const env = {
  ...process.env,
  ESKUL_STATE_DIR: STATE,
  ESKUL_SKIP_ORCHESTRATION: '1',
  ESKUL_BASE_DOMAIN: 'test.local',
  ESKUL_NGINX_DIR: join(STATE, 'nginx'),
  ESKUL_BACKUP_DIR: join(STATE, 'backups'),
  ESKUL_PSQL: `docker exec -i ${PG_CONTAINER} psql`,
  ESKUL_PGDUMP: `docker exec -i ${PG_CONTAINER} pg_dump`,
  ESKUL_PG_SUPER_URL: 'postgresql://eskul:eskul_secret@127.0.0.1:5432/postgres', // sudut pandang container
  ESKUL_PG_MIGRATE_HOSTPORT: `127.0.0.1:${HOST_PORT}`,                            // sudut pandang host
  ESKUL_PG_APP_HOST: 'postgres',
  ESKUL_PG_APP_PORT: '5432',
};

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m); } };

const psql = (sql, db = 'postgres') =>
  execFileSync('docker', ['exec', '-i', PG_CONTAINER, 'psql', '-U', 'eskul', '-d', db, '-tAqc', sql],
    { encoding: 'utf8' }).trim();

function sh(script, args = [], expectFail = false) {
  try {
    const out = execFileSync('bash', [`scripts/${script}`, ...args],
      { cwd: process.cwd(), env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (expectFail) throw new Error(`skrip ${script} seharusnya gagal tapi sukses`);
    return out;
  } catch (e) {
    if (expectFail) return e; // diharapkan
    console.error(`\n--- ${script} gagal ---\n${e.stdout || ''}\n${e.stderr || ''}`);
    throw e;
  }
}

async function checkSchool(info, email) {
  const db = new PrismaClient({ datasourceUrl: info.hostUrl });
  try {
    const roles = await db.role.findMany({ select: { code: true } });
    ok(roles.length === 4, `${info.code}: 4 role (${roles.map((r) => r.code).sort().join(',')})`);

    const users = await db.user.findMany({ include: { role: true } });
    ok(users.length === 1, `${info.code}: tepat 1 user (dapat ${users.length})`);
    ok(users[0]?.role.code === 'ADMIN' && users[0]?.email === email,
      `${info.code}: user = ADMIN ${email}`);
    ok(await argon2.verify(users[0].passwordHash, info.adminPassword),
      `${info.code}: hash password admin cocok`);

    const n = await db.student.count();
    ok(n === 0, `${info.code}: skema penuh ter-migrasi (students count = ${n})`);
  } finally {
    await db.$disconnect();
  }
}

async function main() {
  console.log(`state dir: ${STATE}\n`);

  // bersihkan sisa run sebelumnya
  for (const d of ['eskul_prov_a', 'eskul_prov_b']) {
    try { psql(`DROP DATABASE IF EXISTS ${d}`); psql(`DROP ROLE IF EXISTS ${d}`); } catch { /* ignore */ }
  }

  console.log('[1] provision prov-a & prov-b');
  const a = JSON.parse(sh('provision-school.sh', ['prov-a', 'SD Uji A', 'admin@a.test', 'Admin A']).trim().split('\n').pop());
  const b = JSON.parse(sh('provision-school.sh', ['prov-b', 'SD Uji B', 'admin@b.test', 'Admin B']).trim().split('\n').pop());
  ok(a.db === 'eskul_prov_a' && b.db === 'eskul_prov_b', `nama DB per sekolah (${a.db}, ${b.db})`);
  ok(a.port !== b.port, `port loopback berbeda (${a.port} vs ${b.port})`);

  console.log('[2] isi tiap sekolah');
  await checkSchool(a, 'admin@a.test');
  await checkSchool(b, 'admin@b.test');

  console.log('[3] isolasi: role prov-b tidak boleh connect ke DB prov-a');
  const crossUrl = b.hostUrl.replace('/eskul_prov_b', '/eskul_prov_a');
  const cross = new PrismaClient({ datasourceUrl: crossUrl });
  let blocked = false;
  try { await cross.$queryRaw`SELECT 1`; } catch { blocked = true; }
  await cross.$disconnect().catch(() => {});
  ok(blocked, 'kredensial sekolah B ditolak database sekolah A');

  console.log('[4] tambahkan siswa di A, pastikan tak terlihat di B');
  const da = new PrismaClient({ datasourceUrl: a.hostUrl });
  await da.student.create({ data: { nis: 'ISO-001', fullName: 'Siswa Isolasi', classGrade: '4A', qrToken: 'iso-qr-001' } });
  await da.$disconnect();
  const db2 = new PrismaClient({ datasourceUrl: b.hostUrl });
  const leaked = await db2.student.count();
  await db2.$disconnect();
  ok(leaked === 0, `DB sekolah B tetap kosong (count = ${leaked})`);

  console.log('[5] guard: provision ulang prov-a harus ditolak');
  const dup = sh('provision-school.sh', ['prov-a', 'x', 'y@z.test'], true);
  ok(String(dup.stderr || '').includes('sudah terdaftar'), 'provision duplikat ditolak');

  console.log('[6] list-schools menampilkan keduanya');
  const list = sh('list-schools.sh');
  ok(list.includes('prov-a') && list.includes('prov-b') && list.includes('active'), 'list-schools OK');

  console.log('[7] deprovision keduanya');
  sh('deprovision-school.sh', ['prov-a', '--yes']);
  sh('deprovision-school.sh', ['prov-b', '--yes']);
  const remain = psql("SELECT count(*) FROM pg_database WHERE datname LIKE 'eskul_prov_%'");
  ok(remain === '0', `database prov-* terhapus (sisa ${remain})`);
  const roleRemain = psql("SELECT count(*) FROM pg_roles WHERE rolname LIKE 'eskul_prov_%'");
  ok(roleRemain === '0', `role prov-* terhapus (sisa ${roleRemain})`);
  const reg = execFileSync('bash', ['-c', `tail -n +2 "${STATE}/schools.tsv" | wc -l`], { encoding: 'utf8' }).trim();
  ok(reg === '0', `registry bersih (sisa ${reg} baris)`);
}

main()
  .then(() => {
    rmSync(STATE, { recursive: true, force: true });
    console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} lulus, ${fail} gagal`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error('\nERROR:', e.message);
    console.log(`\nFAIL  ${pass} lulus, ${fail} gagal (+ error)`);
    console.log(`(state dir dibiarkan untuk inspeksi: ${STATE})`);
    process.exit(1);
  });
