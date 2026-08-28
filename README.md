# eskul-backend

Backend API untuk **Ekosistem Presensi & Perkembangan Ekstrakurikuler SD**.

Stack: **NestJS 12 (TypeScript, ESM) · PostgreSQL · Prisma · Redis (ioredis)**.

Referensi arsitektur: `../system-design-ekosistem-ekskul-sd.md`.
Referensi rencana kerja: `../ai-prompts-rencana-pengerjaan.md`.

> **Status: Fase 0 (scaffolding).** Baru kerangka struktur + konfigurasi.
> Belum ada logic bisnis. Skema database (model + migration) dikerjakan di Fase 0.2.

## Struktur folder

```
backend/
├── prisma/
│   ├── schema.prisma        # datasource + generator (model menyusul di Fase 0.2)
│   └── seed.ts              # placeholder seed
├── src/
│   ├── config/
│   │   └── configuration.ts # env terpusat (ConfigModule)
│   ├── prisma/              # PrismaModule + PrismaService (global)
│   ├── redis/               # RedisModule + RedisService (global)
│   ├── common/              # decorators, guards, interceptors, filters, dto (shared)
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
docker compose up --build
```

API: <http://localhost:3000/api/v1/health>

### Opsi B — infra via Docker, API via Node (disarankan saat development)

```bash
cp .env.example .env
# jalankan hanya postgres + redis
docker compose up -d postgres redis

npm install
npm run prisma:generate          # generate Prisma Client (wajib sebelum build/run)
npm run start:dev
```

API: <http://localhost:3000/api/v1/health>

## Skrip npm

| Skrip | Fungsi |
|---|---|
| `npm run start:dev` | Jalankan API dengan watch mode |
| `npm run build` | Compile ke `dist/` |
| `npm test` / `npm run test:cov` | Unit test (Vitest) + coverage |
| `npm run test:e2e` | E2E test |
| `npm run lint` | oxlint |
| `npm run prisma:generate` | Generate Prisma Client |
| `npm run prisma:migrate` | Buat & jalankan migration (dev) — aktif mulai Fase 0.2 |
| `npm run db:seed` | Seed data — aktif mulai Fase 0.2 |

## Konfigurasi environment

Lihat `.env.example` untuk daftar lengkap. Variabel penting Fase 0:

| Var | Keterangan |
|---|---|
| `DATABASE_URL` | Koneksi PostgreSQL (host `postgres` di docker, `localhost` di lokal) |
| `REDIS_HOST` / `REDIS_PORT` | Koneksi Redis |
| `API_PREFIX` | Prefix global route, default `api/v1` |
| `CORS_ALLOWED_ORIGINS` | Daftar origin dipisah koma (web admin, deep link mobile) |

## Definition of Done (Fase 0.1)

- [x] Struktur folder mencerminkan modul-modul dokumen desain
- [x] `docker compose up` menjalankan postgres + redis + api
- [x] README berisi instruksi setup
- [ ] Diverifikasi jalan tanpa error setelah `npm install` (butuh jaringan untuk unduh dependency)
