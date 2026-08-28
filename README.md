# eskul-backend

Backend API untuk **Ekosistem Presensi & Perkembangan Ekstrakurikuler SD**.

Stack: **NestJS 12 (TypeScript, ESM) · PostgreSQL · Prisma · Redis (ioredis)**.

Referensi arsitektur: `../system-design-ekosistem-ekskul-sd.md`.
Referensi rencana kerja: `../ai-prompts-rencana-pengerjaan.md`.

> **Status: Fase 0.2 selesai.** Kerangka struktur + konfigurasi (0.1) dan
> skema database penuh — model Prisma + migration + seed (0.2). Belum ada logic bisnis.

## Struktur folder

```
backend/
├── prisma/
│   ├── schema.prisma        # 13 model, konversi 1:1 dari DDL dokumen desain §3.2
│   ├── migrations/
│   │   ├── 20260828233836_init/
│   │   │   ├── migration.sql   # DDL lengkap (+ extension pgcrypto + 4 CHECK constraint)
│   │   │   └── down.sql        # rollback manual (Prisma tak punya revert per-migration)
│   │   └── migration_lock.toml
│   └── seed.ts              # roles (ADMIN/PEMBINA/ORANGTUA) + 1 admin dummy (idempoten)
├── src/
│   ├── config/configuration.ts # env terpusat (ConfigModule)
│   ├── prisma/                  # PrismaModule + PrismaService (global)
│   ├── redis/                   # RedisModule + RedisService (global)
│   ├── common/                  # decorators, guards, interceptors, filters, dto (shared)
│   ├── modules/
│   │   ├── auth/            # autentikasi & RBAC            (Fase 1.1)
│   │   ├── users/           # akun users lintas-role
│   │   ├── students/        # data master siswa + qr_token  (Fase 1.2 / 2.2)
│   │   ├── coaches/         # data master guru pembina      (Fase 1.2)
│   │   ├── parents/         # relasi ortu-siswa, dashboard  (Fase 1.4 / 2.4)
│   │   ├── extracurriculars/# ekskul, jadwal, keanggotaan   (Fase 1.2)
│   │   ├── attendance/      # sesi presensi + materi        (Fase 1.3 / 2.x)
│   │   ├── notifications/   # push FCM via job queue        (Fase 1.5)
│   │   ├── reports/         # export PDF/Excel async        (Fase 3.1)
│   │   └── audit/           # audit log data sensitif       (Fase 1.1 / 4.1)
│   ├── app.module.ts
│   └── main.ts             # global prefix /api/v1, helmet, CORS, ValidationPipe
├── Dockerfile
├── docker-compose.yml      # postgres + redis + api
└── .env.example
```

Setiap modul fitur berisi trio `*.module.ts` / `*.controller.ts` / `*.service.ts` sebagai kerangka.

## Menjalankan secara lokal

### Prasyarat
- Node.js ≥ 22, npm ≥ 10
- Docker + Docker Compose (untuk PostgreSQL & Redis)

### Opsi A — semuanya via Docker

```bash
cp .env.example .env
docker compose up --build          # postgres + redis + api
# di terminal lain, setelah container "api" sehat:
docker compose exec api npx prisma migrate deploy
docker compose exec api npm run db:seed
```

API: <http://localhost:3000/api/v1/health>

### Opsi B — infra via Docker, API via Node (disarankan saat development)

```bash
cp .env.example .env
docker compose up -d postgres redis   # hanya infra

npm install
npm run prisma:generate               # generate Prisma Client (wajib sebelum build/run)
npm run prisma:migrate:deploy         # terapkan migration ke DB
npm run db:seed                       # roles + admin dummy
npm run start:dev
```

API: <http://localhost:3000/api/v1/health>
Admin dummy hasil seed: `admin@eskul.test` / `Admin#12345` (dev only).

> **Bentrok port?** Bila 5432/6379 sudah dipakai PostgreSQL/Redis lain di mesin Anda,
> ubah `POSTGRES_HOST_PORT` / `REDIS_HOST_PORT` di `.env` (default 55432 / 63790),
> lalu sesuaikan `DATABASE_URL` & `REDIS_PORT`. `docker compose` membaca variabel ini.

## Skema database & migration

- `prisma/schema.prisma` adalah konversi **1:1** dari DDL pada dokumen desain
  bagian 3.2. Nama tabel & kolom **tidak diubah** (snake_case asli via `@map`/`@@map`).
- Semua **UNIQUE**, **index** (nama `idx_*` dipertahankan), dan **default DB**
  (`gen_random_uuid()`, `CURRENT_DATE`, `now()`) identik dengan DDL.
- **4 CHECK constraint** (`students.gender`, `extracurricular_schedules.day_of_week`,
  `attendance_details.status`, `attendance_details.activeness_score`) tidak bisa
  dinyatakan di schema Prisma → ditambahkan sebagai raw SQL di `migration.sql`.
  Konsekuensi: `prisma migrate dev` bisa melaporkannya sebagai "drift" (tidak
  berbahaya). Gunakan `prisma migrate deploy` / `prisma:reset` untuk alur normal.
- **FK**: `ON DELETE CASCADE` sesuai DDL; FK lain `ON DELETE/UPDATE NO ACTION`.

### Rollback

Prisma tidak punya `migrate:revert` per-migration seperti TypeORM. Pilihan:

| Cara | Perintah |
|---|---|
| Dev — drop semua, re-apply, re-seed | `npm run prisma:reset` |
| Manual (audit / staging) | `psql "$DATABASE_URL" -f prisma/migrations/20260828233836_init/down.sql` |

Sudah diverifikasi: apply-dari-kosong → `down.sql` → apply-ulang → seed, semuanya bersih.

## Skrip npm

| Skrip | Fungsi |
|---|---|
| `npm run start:dev` | Jalankan API dengan watch mode |
| `npm run build` | Compile ke `dist/` |
| `npm test` / `npm run test:cov` | Unit test (Vitest) + coverage |
| `npm run lint` | oxlint |
| `npm run prisma:generate` | Generate Prisma Client |
| `npm run prisma:migrate` | Buat migration baru (dev) |
| `npm run prisma:migrate:deploy` | Terapkan migration yang sudah ada |
| `npm run prisma:reset` | Drop + re-apply + seed (dev only) |
| `npm run prisma:studio` | Prisma Studio (GUI data) |
| `npm run db:seed` | Seed roles + admin dummy (idempoten) |

## Konfigurasi environment

Lihat `.env.example` untuk daftar lengkap.

| Var | Keterangan |
|---|---|
| `DATABASE_URL` | Koneksi PostgreSQL. Host `127.0.0.1:<POSTGRES_HOST_PORT>` untuk run via Node; service `api` di compose memakai host `postgres:5432` |
| `POSTGRES_HOST_PORT` / `REDIS_HOST_PORT` | Port host untuk container (hindari bentrok) |
| `REDIS_HOST` / `REDIS_PORT` | Koneksi Redis |
| `API_PREFIX` | Prefix global route, default `api/v1` |
| `CORS_ALLOWED_ORIGINS` | Daftar origin dipisah koma (web admin, deep link mobile) |

## Catatan / utang teknis

- `npm audit` melaporkan 3 high (rantai `prisma` → `@prisma/config` → `deepmerge-ts`).
  Hanya menyentuh **Prisma CLI** (devDependency), bukan runtime. Ditangani di Fase 4.3
  bersama dependency scan menyeluruh, atau saat Prisma merilis patch.
- Peringatan `package.json#prisma` deprecated — akan dipindah ke `prisma.config.ts`
  saat upgrade ke Prisma 7.

## Definition of Done

### Fase 0.1
- [x] Struktur folder mencerminkan modul-modul dokumen desain
- [x] `docker compose up` menjalankan postgres + redis + api
- [x] README berisi instruksi setup
- [x] `npm install` + `npm run build` + `npm test` lulus

### Fase 0.2
- [x] Migration berjalan sukses dari kosong (`prisma migrate deploy`) tanpa error — **verified**
- [x] Seluruh constraint DDL ada: 13 tabel, 17 FK, 14 index `idx_*`, semua UNIQUE, 4 CHECK, extension pgcrypto — **verified via `\d`/`pg_constraint`**
- [x] Rollback (`down.sql`) berfungsi tanpa merusak, lalu bisa apply-ulang — **verified**
- [x] Seed: 3 roles + 1 admin dummy, idempoten (aman dijalankan berulang) — **verified**
