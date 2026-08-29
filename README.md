# eskul-backend

Backend API untuk **Ekosistem Presensi & Perkembangan Ekstrakurikuler SD**.

Stack: **NestJS 12 (TypeScript, ESM) · PostgreSQL · Prisma · Redis (ioredis)**.

Referensi arsitektur: `../system-design-ekosistem-ekskul-sd.md`.
Referensi rencana kerja: `../ai-prompts-rencana-pengerjaan.md`.

> **Status: Fase 4.1 selesai.** 0.1–1.5 (MVP) + 2.1–2.4 + 3.1–3.3 (Fase 3 lengkap) +
> **4.1 Audit Log Lengkap** — `AuditInterceptor` global berbasis `@Audit(...)` mencatat
> semua akses data siswa/ortu ke `audit_logs`; `GET /admin/audit-logs` (filter + free-text
> JSONB) khusus role **`ADMIN_SUPER`**.

## Struktur folder

```
backend/
├── prisma/
│   ├── schema.prisma        # 15 model (13 dari DDL §3.2 + device_tokens Fase 1.5 + report_exports Fase 3.1)
│   ├── migrations/
│   │   ├── 20260828233836_init/        # DDL lengkap (+ pgcrypto + 4 CHECK) + down.sql
│   │   ├── 20260829063133_add_device_tokens/  # tabel device_tokens (FCM) + down.sql
│   │   ├── 20260829123518_add_report_exports/ # tabel report_exports (job export) + down.sql
│   │   ├── 20260829230003_add_audit_log_indexes/ # idx created_at/action + GIN trgm metadata + down.sql
│   │   └── migration_lock.toml
│   └── seed.ts              # roles (ADMIN_SUPER/ADMIN/PEMBINA/ORANGTUA) + 2 admin dummy (idempoten)
├── src/
│   ├── config/configuration.ts # env terpusat (ConfigModule)
│   ├── prisma/                  # PrismaModule + PrismaService (global)
│   ├── redis/                   # RedisModule + RedisService (global)
│   ├── queue/                   # QueueModule — BullMQ di atas Redis (attempts:3, backoff exp) (Fase 1.5)
│   ├── common/
│   │   ├── decorators/         # @Public, @Roles, @CurrentUser, @Audit (Fase 4.1)
│   │   ├── guards/             # JwtAuthGuard, RolesGuard (+ hierarki ADMIN_SUPER⊃ADMIN)
│   │   ├── interceptors/       # AuditInterceptor global — tulis audit_logs dari @Audit (Fase 4.1)
│   │   └── types/              # AuthenticatedUser, RoleCode, roleSatisfies, *TokenPayload
│   ├── modules/
│   │   ├── auth/            # ✅ login/refresh/logout/me + TokenService (JWT+Redis)  (Fase 1.1)
│   │   ├── audit/           # ✅ AuditService.log()/query()/facets() + GET /admin/audit-logs (ADMIN_SUPER)  (1.1/4.1)
│   │   ├── users/           # akun users lintas-role
│   │   ├── students/        # ✅ CRUD + soft-delete + qr_token + import Excel        (Fase 1.2)
│   │   ├── coaches/         # ✅ CRUD (buat user PEMBINA) + soft-delete              (Fase 1.2)
│   │   ├── extracurriculars/# ✅ CRUD + jadwal (anti-bentrok) + anggota (kapasitas)  (Fase 1.2)
│   │   ├── attendance/      # ✅ POST /attendance/submit + /coach/* (today/roster/history)  (Fase 1.3)
│   │   ├── parents/         # ✅ /parent/* (children, link-request, child-progress) + /admin/parent-relations  (Fase 1.4)
│   │   ├── notifications/   # ✅ BullMQ processor + inbox + device tokens + PushSender  (Fase 1.5)
│   │   ├── reports/         # ✅ export PDF/Excel async (queue) + signed-URL download   (Fase 3.1)
│   │   │   ├── render/          # attendance-dataset (agregasi) + pdf-renderer (pdfkit) + xlsx-renderer (exceljs)
│   │   │   ├── storage/         # ReportStorage (interface) + LocalDiskReportStorage + factory
│   │   │   └── report-signer.ts # HMAC-SHA256 + expires untuk URL unduhan
│   │   ├── analytics/       # ✅ GET /admin/analytics/overview — agregat + cache Redis TTL 1 jam  (Fase 3.2)
│   │   └── periodic-reports/# ✅ cron mingguan/bulanan → fan-out + batch → notifikasi ortu  (Fase 3.3)
│   │       ├── period.ts        # window & key mingguan/bulanan + classifyTrend (pure)
│   │       ├── *.service.ts     # @Cron + run-guard Redis + enqueue fan-out
│   │       └── *.processor.ts   # fan-out → batch ber-delay → enqueueUserNotification per wali
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

## Autentikasi & RBAC (Fase 1.1)

Endpoint (`/api/v1`), sesuai dokumen desain bagian 4.3 & 7.1:

| Method & Path | Akses | Fungsi |
|---|---|---|
| `POST /auth/login` | publik | email/no. HP + password → `{ accessToken, refreshToken, tokenType, expiresIn, user }` |
| `POST /auth/refresh` | publik | `{ refreshToken }` → pasangan token baru (**rotasi**: jti lama dicabut) |
| `POST /auth/logout` | Bearer | cabut **semua** sesi refresh milik user |
| `GET /auth/me` | Bearer | profil ringkas user login (tanpa `password_hash`) |

- **Access token**: JWT (`JWT_ACCESS_SECRET`), umur **15 menit**, payload `{ sub, role, type:'access' }`.
- **Refresh token**: JWT (`JWT_REFRESH_SECRET`), umur `JWT_REFRESH_TTL` (default 30 hari),
  payload `{ sub, jti, type:'refresh' }`. Sesi disimpan di Redis sebagai **allow-list**
  (`auth:rt:{jti}` → userId); logout / rotasi menghapusnya → token lama langsung invalid.
- **Password**: hash **argon2id** (`argon2.verify` saat login). Tidak pernah plaintext.
- **Pesan login gagal generik** (`"Email/No. HP atau password salah."`) untuk semua sebab
  (user tak ada / nonaktif / password salah) — tidak membocorkan mana yang salah.
- **Audit**: setiap `LOGIN_SUCCESS` / `LOGIN_FAILED` (+ alasan di `metadata`) / `TOKEN_REFRESH`
  / `LOGOUT` ditulis ke tabel `audit_logs` via `AuditService` (modul `audit`, global).

### RBAC — dipakai di modul lain

Dua guard **global** (terdaftar di `AuthModule` via `APP_GUARD`, urutan: auth → role):

```ts
// route publik — lewati autentikasi
@Public()
@Get('health') ...

// route butuh login saja (role apa pun)
@Get('me') me(@CurrentUser() user: AuthenticatedUser) ...

// route dibatasi role tertentu → selain itu 403
@Roles('ADMIN')
@Get('admin/students') ...
```

Helper di `src/common/`: `@Public()`, `@Roles(...)`, `@CurrentUser()`, `@Audit(...)`, tipe
`AuthenticatedUser` / `RoleCode`. Role: `ADMIN_SUPER` ⊃ `ADMIN` ⊃ … (`roleSatisfies()` di
`RolesGuard` — `@Roles('ADMIN')` juga lolos untuk `ADMIN_SUPER`; `@Roles('ADMIN_SUPER')` tidak
lolos untuk `ADMIN` biasa).

## Data Master admin (Fase 1.2)

Semua di bawah `/api/v1/admin/*`, wajib JWT role **ADMIN** (`@Roles('ADMIN')`).
Listing memakai query `page`, `pageSize` (≤100), `search`, dan filter spesifik.

| Path | Operasi |
|---|---|
| `GET/POST /admin/students`, `GET/PUT/DELETE /admin/students/:id`, `POST /admin/students/:id/reactivate` | CRUD siswa. `POST` auto-generate `qr_token` acak (bukan turunan NIS). `DELETE` = soft-delete (`is_active=false`), baris & histori presensi tetap utuh. Filter: `classGrade`, `isActive`. |
| `POST /admin/students/:id/rotate-qr` | *(Fase 2.2)* `qr_token` acak baru + `qr_token_rotated_at`; token lama langsung tidak berlaku. Audit `ROTATE_QR_TOKEN`. |
| `POST /admin/students/import` (multipart `file`) | Import massal `.xlsx` (header: `nis`,`nama`,`kelas`, opsional `gender`,`tanggal_lahir`). Satu `createMany`; return `{ created, skipped, errors[] }`. |
| `GET/POST /admin/coaches`, `GET/PUT/DELETE /admin/coaches/:id`, `.../reactivate` | CRUD pembina. `POST` membuat akun `users` role PEMBINA (+password argon2id) & `coaches` dalam satu transaksi. `DELETE` = nonaktifkan `users` (tabel `coaches` tak punya `is_active`). |
| `GET/POST /admin/extracurriculars`, `GET/PUT/DELETE /admin/extracurriculars/:id`, `.../reactivate` | CRUD ekskul. Filter: `category`, `isActive`. |
| `POST/PUT/DELETE /admin/extracurriculars/:id/schedules[/:sid]` | Jadwal ekskul. Validasi: jam selesai > mulai; **tolak bentrok** jam di lokasi sama (lintas ekskul). `DELETE` = soft (`is_active=false`). |
| `GET/POST /admin/extracurriculars/:id/members`, `DELETE .../members/:studentId` | Keanggotaan. `POST { studentIds:[] }` — validasi siswa aktif, cek `max_capacity`, skip duplikat. |

Setiap `create/update/delete` menulis `audit_logs` (action `CREATE_STUDENT`, `IMPORT_STUDENTS`,
`DEACTIVATE_COACH`, `CREATE_SCHEDULE`, `ENROLL_MEMBERS`, …) dengan `entity_type` & `entity_id` yang benar.

## Presensi & materi latihan (Fase 1.3)

Endpoint Pembina (`@Roles('PEMBINA')`). "Ekskul milik pembina" = `extracurriculars.default_coach_id`.

| Path | Fungsi |
|---|---|
| `GET /coach/today-sessions` | Jadwal ekskul hari ini (zona Asia/Jakarta) milik pembina login + status sesi bila sudah disubmit hari itu |
| `GET /coach/extracurriculars/:id/roster` | Siswa aktif untuk presensi (403 bila bukan pembina ekskul tsb) |
| `GET /coach/sessions?limit=` | Riwayat sesi pembina + ringkasan per status + `avgActiveness` (rata-rata keaktifan HADIR, Fase 2.3) |
| `POST /attendance/submit` | Satu request: presensi + materi. Kontrak dokumen desain **bagian 4.1** |
| `POST /coach/students/qr-scan` | *(Fase 2.2)* `{ qr_token, extracurricular_id }` → `{ student }`. **404** `{error:'QR_INVALID'}` (token asing / sudah dirotasi), **422** `{error:'NOT_A_MEMBER'}`, **403** bukan pembina ekskul. Audit `QR_SCAN` |

`POST /attendance/submit`:
- **201** `{ session_id, status:'SUBMITTED', synced_at, summary:{ total_students, hadir, izin, sakit, alpa } }`
- **409** `{ error:'SESSION_ALREADY_SYNCED', message, existing_session_id }` — replay `client_generated_id`
  yang sama, **atau** sudah ada sesi untuk `(extracurricular_id, session_date, coach_id)` (idempotency + UNIQUE constraint)
- **422** `{ error:'VALIDATION_ERROR', details:[{ field, message }] }` — status di luar enum,
  siswa bukan anggota (`attendances[i].student_id`), tanggal masa depan, `schedule_id` tak cocok,
  **`activeness_score` untuk siswa non-HADIR** (`attendances[i].activeness_score`, Fase 2.3).
  `skill_notes` / `personal_notes` diperbolehkan untuk status apa pun.
- **403** bila bukan pembina ekskul tsb
- `Idempotency-Key` header diterima (opsional; sama dengan `client_generated_id`)
- submit sukses → `audit_logs` action `SUBMIT_ATTENDANCE`

> ValidationPipe global kini memakai `exceptionFactory` terstruktur
> (`{ error:'VALIDATION_ERROR', details:[{field,message}] }`, kode 400 untuk endpoint umum).
> `Validation422Filter` memetakannya ke **422** khusus `/attendance/submit`.

## Dashboard Orang Tua (Fase 1.4)

| Path | Akses | Fungsi |
|---|---|---|
| `POST /auth/register` | publik | Pendaftaran mandiri ORANGTUA (`consent:true` wajib) → users+parents + token; audit `PARENT_CONSENT_GIVEN` |
| `GET /parent/children` | ORANGTUA | Anak dengan relasi `APPROVED` |
| `POST /parent/link-request` | ORANGTUA | Ajukan relasi via `{ nis, studentName }` (verifikasi silang nama) → `PENDING`. Relasi yang **REJECTED tak bisa diajukan ulang < 24 jam** → 409 (Fase 2.4) |
| `GET /parent/child-progress/:studentId` | ORANGTUA | **Kontrak §4.2**. Wajib relasi `APPROVED`, jika tidak → **403** `{ error:'UNAUTHORIZED_RELATION' }` |
| `GET /admin/parent-relations?status=` | ADMIN | Daftar relasi (default `PENDING`) + info ortu & siswa + **`suspicious`** (Fase 2.4: nomor HP dgn > 5 siswa berbeda / 24 jam) |
| `PUT /admin/parent-relations/:id/approve` | ADMIN | `{ decision:'APPROVED'\|'REJECTED', reason? }` → set `approved_by`/`approved_at` + audit `APPROVE`/`REJECT_PARENT_RELATION` + **notif push `RELATION_DECISION`** ke ortu via queue (Fase 2.4) |

`child-progress` payload (snake_case, sesuai kontrak): `student{full_name,class_grade,photo_url}`,
`extracurriculars[]{ id, name, attendance_summary{total_sessions,hadir,izin,sakit,alpa,percentage},
activeness_trend[{bucket,label,avg_score,sessions}] (agregat per minggu/bulan — Fase 3.2),
materials_timeline[{date,description,coach_name,coach_feedback}] }`,
`latest_notification`. Query: `period` (weekly=90h / monthly=180h), `from`/`to`, `extracurricularId`.
Ekskul tanpa sesi tetap muncul (`total_sessions:0`). Akses → audit `VIEW_STUDENT_DATA`.

Notifikasi generik ke satu user memakai job `notify-user` yang digeneralkan
(`type`/`title`/`body`/`payload`/`dedupeKey`) via `NotificationsService.enqueueUserNotification()`;
idempotensi lewat `payload._k = dedupeKey` (Fase 2.4).

## Notifikasi Push (Fase 1.5)

**Alur:** `POST /attendance/submit` (SUBMITTED) → `void enqueueAttendanceDone(sessionId)`
(hanya `queue.add`, ~20ms, tidak memblokir response) → BullMQ worker:
job `attendance-done` (fan-out) → satu job `notify-user` per ortu ber-relasi `APPROVED`
(jobId deterministik `notify_<sessionId>_<userId>` → dedupe) → buat baris `notifications`
(idempoten: cek `payload.sessionId` lebih dulu) + kirim push ke tiap `device_tokens`.

- **Retry**: BullMQ `attempts: 3`, backoff eksponensial (1s/2s/4s). Job push gagal → di-retry;
  gagal permanen → tetap tersimpan (`removeOnFail: false` = dead-letter) + di-log (`@OnWorkerEvent('failed')`).
- **PushSender**: `LoggingPushSender` (dev, default) / `FirebasePushSender` (bila `FCM_CREDENTIALS_PATH` valid).
  Token ditolak permanen → dihapus dari `device_tokens`. `PUSH_FAIL_TOKENS` (csv) → simulasi gagal untuk uji.
- Skema: migration `20260829063133_add_device_tokens` menambah tabel `device_tokens`
  (tidak ada di DDL asli) + `down.sql`.

| Path | Fungsi |
|---|---|
| `POST /notifications/devices` | `{ token, platform? }` — daftar/segarkan device token (upsert) |
| `DELETE /notifications/devices` | `{ token }` — hapus token milik user |
| `GET /notifications?page=&pageSize=&unreadOnly=` | Inbox user; `meta.unread` disertakan |
| `GET /notifications/unread-count` | `{ unread }` |
| `POST /notifications/read` `{ ids:[] }` / `POST /notifications/read-all` | Tandai dibaca → `{ updated, unread }` |

## Export Laporan PDF/Excel (Fase 3.1)

Kontrak §4: `GET /api/v1/admin/reports/attendance?format=pdf|xlsx`. **Generate selalu asinkron**
lewat job queue BullMQ (`reports` queue) — request hanya `INSERT` baris `report_exports` +
`queue.add` lalu balas **202**, tidak menunggu file jadi (uji: 500 siswa → respons 23 ms,
job selesai ~1 dtk).

| Path (semua `@Roles('ADMIN')` kecuali download) | Fungsi |
|---|---|
| `GET /admin/reports/attendance/preview?classGrade=&extracurricularId=&dateFrom=&dateTo=&page=&pageSize=` | Tabel data (1 baris per siswa×ekskul): hadir/izin/sakit/alpa, %kehadiran, rata2 keaktifan, catatan pembina. `meta.dateFrom/dateTo` = rentang efektif (default 180 hari terakhir) |
| `GET /admin/reports/attendance?format=pdf\|xlsx&<filter>` | **202** — buat `report_exports` (PENDING) + enqueue job + audit `EXPORT_REPORT` (menyimpan `format` + `filters`) |
| `GET /admin/reports/exports?page=&pageSize=` | Riwayat export; baris READY menyertakan `downloadUrl` + `downloadExpiresAt` yang baru di-sign |
| `GET /admin/reports/exports/:id` | Status satu export (polling web) + `downloadUrl` bila READY |
| `GET /admin/reports/downloads/:id?expires=&sig=` | **`@Public()`** — stream file. Otorisasi murni dari **HMAC-SHA256(`id.expires`)** + `expires`. Sig salah → 403; `expires` lewat / file lewat masa simpan → 410; belum READY → 409 |

- **Worker** `ReportsProcessor` (`@Processor('reports')`, concurrency 2): `runExportJob` → set PROCESSING →
  `buildAttendanceDataset` (agregasi via beberapa `findMany`, aman untuk ratusan siswa) →
  `renderAttendancePdf` (pdfkit, 1 halaman "rapor" per siswa) / `renderAttendanceXlsx` (exceljs, sheet Info + Data) →
  `storage.put` → set READY + `storageKey`/`fileName`/`fileSize`/`rowCount`/`expiresAt` (now + TTL).
  Gagal → status FAILED + `errorMessage`, lalu rethrow (retry 3× + dead-letter mengikuti `QueueModule`).
- **Storage** — interface `ReportStorage` (token DI `REPORT_STORAGE`); default `LocalDiskReportStorage`
  (`REPORT_STORAGE_DIR`, default `./storage/reports`, dengan proteksi path-traversal). Driver S3 tinggal
  ditambah sebagai implementasi lain tanpa mengubah service.
- Migration `20260829123518_add_report_exports` menambah tabel `report_exports` (bukan dari DDL asli) + `down.sql`.

## Dashboard Analitik Sekolah (Fase 3.2)

| Path (`@Roles('ADMIN')`) | Fungsi |
|---|---|
| `GET /admin/analytics/overview` | Agregat sekolah. Di-cache Redis (`analytics:overview:v1`, TTL 1 jam). Body: `cached` (bool), `kpi`, `participationByCategory[]`, `attendanceTrend[]` (8 minggu), `lowAttendanceByExtracurricular[]` (top-5 kehadiran terendah / ekskul). Audit `VIEW_ANALYTICS_OVERVIEW`. |
| `GET /admin/analytics/overview?fresh=1` | Lewati cache & hitung ulang. |

- Semua angka dihitung dari **window 8 minggu terakhir** (`AnalyticsService.compute` — beberapa
  `findMany` paralel + agregasi di memori), jadi tetap **< 2 detik walau riwayat 1 tahun ajaran
  penuh** (uji skala: 6 ekskul × 500 siswa × 52 minggu = 156k baris detail → ~820 ms uncached, ~11 ms cached).
- `participationByCategory`: jumlah ekskul + keanggotaan + siswa unik per kategori (null → `LAINNYA`).
- `attendanceTrend`: selalu 8 titik berurutan (minggu tanpa data → 0, bukan error).
- `lowAttendanceByExtracurricular`: hanya siswa yang punya ≥ 1 sesi tercatat di window, urut % menaik.

**Tren keaktifan Orang Tua (Bagian A).** `activeness_trend` pada `GET /parent/child-progress/:id`
kini **diagregasi** sesuai `?period=weekly|monthly` (helper `bucketActivenessTrend`): tiap item
`{ bucket, label, avg_score, sessions }`, terurut kronologis, hanya baris `HADIR` ber-skor.
Aman untuk data minim (1 titik pun tetap 1 entri).

## Laporan Berkala Otomatis (Fase 3.3)

`@nestjs/schedule` `@Cron` (zona **Asia/Jakarta**):

| Jadwal | Cron | Isi |
|---|---|---|
| Mingguan | `0 18 * * 0` (Minggu 18:00) | Ringkasan Senin–Minggu berjalan per siswa: jumlah sesi, %hadir, rata-rata keaktifan → notifikasi `WEEKLY_REPORT` |
| Bulanan | `0 6 1 * *` (tgl 1, 06:00) | Ringkasan bulan kalender lalu + **tren** vs bulan sebelumnya (`naik`/`turun`/`stabil`, ambang ±5 poin) → `MONTHLY_REPORT` |

Alur: `@Cron` → `PeriodicReportsService.dispatch` (**run-guard**: `SET periodic:lock:<key> NX EX 6h`
→ satu periode dijadwalkan sekali) → job `periodic-fanout` di queue `periodic-reports`
→ worker mengumpulkan siswa ber-wali `APPROVED`, memecah ke **batch 200** dengan
**jeda progresif 750 ms** (`delay: i*750`) → tiap `periodic-batch` menghitung ringkasan per
siswa lalu `NotificationsService.enqueueUserNotification` satu per wali `APPROVED`.

**Idempotensi berlapis** (retry / cron dobel tidak mengirim notifikasi ganda):
- run-guard Redis per periode;
- `jobId` fan-out & batch deterministik (`periodic_fanout_<key>` / `periodic_batch_<key>_<i>`);
- `dedupeKey` `wr:<key>:<studentId>` / `mr:<key>:<studentId>` → worker `notify-user` cek
  `payload._k` sebelum membuat baris `notifications`.
- Pemicu manual `force:true` memakai `jobId` ber-suffix `runId` agar **bisa** dijalankan
  ulang; `dedupeKey` tetap mencegah baris ganda.

**Pemicu manual (ops / uji):** `POST /admin/periodic-reports/run` `{ type:'weekly'|'monthly', force? }`
(`@Roles('ADMIN')`, audit `RUN_PERIODIC_REPORT`).

**Skala:** cron hanya *memicu*; kerja berat ada di worker + dibatch. Uji 2.000 siswa →
respons `/run` 6 ms, `/auth/me` p95 **10 ms** selama worker jalan, 2.000 notifikasi terkirim,
re-run `force` → tetap 2.000 (nol duplikat).

## Audit Log Lengkap & Review (Fase 4.1)

**Mekanisme.** `@Audit({ action, entityType, entityIdParam?, captureQuery? })` di handler +
`AuditInterceptor` global (`APP_INTERCEPTOR` di `AuditModule`) menulis **satu baris
`audit_logs` otomatis** setelah request selesai — sukses (`metadata.outcome:'success'`)
maupun gagal (`outcome:'error'` + `statusCode`). Tidak ada `audit.log()` manual untuk
akses-baca; kegagalan tulis audit tidak pernah menggagalkan request.

**Sub-permission.** Role baru **`ADMIN_SUPER`** (seed) — `roleSatisfies()` membuatnya
mewarisi seluruh hak `ADMIN`, tetapi `GET /admin/audit-logs*` `@Roles('ADMIN_SUPER')`
saja. Seed dev: `admin@eskul.test` (`ADMIN`) & `superadmin@eskul.test` / `Super#12345` (`ADMIN_SUPER`).

| Endpoint (`@Roles('ADMIN_SUPER')`) | Fungsi |
|---|---|
| `GET /admin/audit-logs?userId&action&entityType&entityId&dateFrom&dateTo&q&page&pageSize` | Query ber-filter. `q` = free-text di `action` / `metadata::text` / nama & email user. Raw SQL → pakai `idx_audit_created/action/entity` + **GIN trigram `idx_audit_metadata_trgm`**. |
| `GET /admin/audit-logs/facets` | `{ actions[], entityTypes[] }` untuk dropdown filter. |

Migration `20260829230003_add_audit_log_indexes`: `idx_audit_created`, `idx_audit_action`,
`CREATE EXTENSION pg_trgm` + `idx_audit_metadata_trgm` (GIN atas `(metadata::text)`), + `down.sql`.
**Skala:** 500 k baris → filter action+tanggal 52 ms, entityType+paginasi 49 ms, `userId` 58 ms,
free-text trigram 937 ms, facets 84 ms (semua < 3 dtk — DoD).

### Checklist cakupan audit (endpoint yang menyentuh data personal siswa/ortu)

| Endpoint | Aksi audit | Mekanisme |
|---|---|---|
| `GET /admin/students` | `LIST_STUDENTS` | `@Audit` interceptor |
| `GET /admin/students/:id` | `VIEW_STUDENT_DATA` | `@Audit` interceptor |
| `GET /admin/coaches` / `:id` | `LIST_COACHES` / `VIEW_COACH_DATA` | `@Audit` interceptor |
| `GET /admin/extracurriculars/:id/members` | `VIEW_EXTRACURRICULAR_ROSTER` | `@Audit` interceptor |
| `GET /coach/extracurriculars/:id/roster` | `VIEW_EXTRACURRICULAR_ROSTER` | `@Audit` interceptor |
| `GET /parent/children` | `LIST_LINKED_CHILDREN` | `@Audit` interceptor |
| `GET /parent/child-progress/:id` | `VIEW_STUDENT_DATA` | service (metadata kaya: period/from/to) |
| `GET /admin/parent-relations` | `LIST_PARENT_RELATIONS` | `@Audit` interceptor |
| `GET /admin/reports/attendance/preview` | `PREVIEW_REPORT` | `@Audit` interceptor |
| `GET /admin/reports/attendance?format=` | `EXPORT_REPORT` | service (metadata: format + filter) |
| `GET /admin/reports/downloads/:id` (`@Public`) | `DOWNLOAD_REPORT` | `@Audit` interceptor |
| `GET /admin/analytics/overview` | `VIEW_ANALYTICS_OVERVIEW` | `@Audit` interceptor |
| CRUD siswa/pembina/anggota, submit presensi, QR scan/rotasi, register/approve relasi ortu, run laporan berkala | `CREATE_*`/`UPDATE_*`/`ENROLL_*`/`SUBMIT_ATTENDANCE`/`QR_SCAN`/`ROTATE_QR_TOKEN`/`APPROVE_PARENT_RELATION`/… | service-level `audit.log()` (sudah 100% sejak Fase 1.2–3.3) |
| Auth | `LOGIN_SUCCESS/FAILED`, `LOGOUT`, `TOKEN_REFRESH` | service (Fase 1.1) |
| **Tidak diaudit (bukan data personal):** `GET /coach/today-sessions` & `/coach/sessions` (jadwal/agregat milik sendiri), `GET /admin/extracurriculars` & `/:id` (metadata ekskul), `GET /admin/reports/exports*` (status job), `GET /notifications/*` (inbox sendiri), `GET /auth/me` | — | — |

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
| `REPORT_STORAGE_DIR` | Direktori file export bila S3 tak dikonfigurasi (default `./storage/reports`) |
| `REPORT_SIGNED_URL_TTL` | Umur signed URL unduhan (detik), default 3600 |
| `REPORT_SIGNING_SECRET` | Rahasia HMAC penanda-tangan URL unduhan; kosong → pakai `JWT_ACCESS_SECRET` |

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

### Fase 1.1
- [x] Login gagal → pesan generik, tidak membocorkan email vs password — **unit + e2e verified**
- [x] Role guard menolak akses lintas-role (403) — **unit verified (RolesGuard)**
- [x] Semua percobaan login (sukses/gagal) tercatat di `audit_logs` — **e2e verified (4 baris: FAILED/SUCCESS/REFRESH/LOGOUT)**
- [x] Refresh token yang di-revoke (rotasi & logout) → 401 — **e2e verified via Redis**
- [x] Coverage modul auth ≥ 80% — **stmts 98.9% / lines 100% / guards 100%** (`npm run test:cov`)
- [x] E2E smoke (login/me/refresh/logout terhadap Postgres+Redis nyata): 17/17 assertion — **verified**

### Fase 1.2
- [x] Import Excel massal siswa ≥ 100 baris tanpa timeout — **e2e: 120 baris ~65ms** (satu `createMany`)
- [x] Nonaktifkan siswa/pembina tidak menghapus data — **e2e: baris tetap ada, `is_active=false`**
- [x] Validasi cegah data ganda (NIS duplikat, jadwal bentrok jam di lokasi sama) — **e2e: 409**
- [x] Semua aksi CRUD tercatat di `audit_logs` dengan `entity_type` & `entity_id` benar — **verified via psql**
- [x] Seluruh endpoint `/admin/*` menolak non-ADMIN (403) & tanpa token (401) — **e2e verified**
- [x] E2E data-master vs Postgres nyata: 33/33 assertion; 42 unit test hijau

### Fase 1.3
- [x] `client_generated_id` idempoten: replay → 409 `SESSION_ALREADY_SYNCED` (tunjuk sesi lama) — **e2e**
- [x] UNIQUE `(extracurricular_id, session_date, coach_id)` → 409 walau `client_generated_id` beda — **e2e**
- [x] Error validasi 422 bentuk `{error, details:[{field,message}]}` per field (`attendances[i].status`, dst) — **e2e**
- [x] `summary` benar (hadir/izin/sakit/alpa/total) & status akhir `SUBMITTED`; audit `SUBMIT_ATTENDANCE` — **e2e**
- [x] RBAC: hanya PEMBINA; hanya ekskul yang diampu (403) — **e2e**
- [x] E2E attendance vs Postgres nyata: 19/19 assertion; 51 unit test hijau

### Fase 1.4
- [x] Ortu tanpa relasi APPROVED **tidak bisa** melihat data anak apa pun (403 `UNAUTHORIZED_RELATION`)
      sebelum approve, 200 setelah, 403 utk siswa lain — **verifikasi via test API langsung**
- [x] Dashboard `child-progress` menampilkan state jelas saat kosong (ekskul tanpa sesi → `total_sessions:0`) — **e2e**
- [x] `link-request` → PENDING; dedup 409; nama tak cocok 400; NIS tak ada 404 — **e2e**
- [x] Admin approve → APPROVED + audit; RBAC lintas-role 403 — **e2e**
- [x] E2E parent vs Postgres nyata: 24/24 assertion; 57 unit test hijau

### Fase 1.5
- [x] Submit presensi direspons cepat meski banyak ortu — **e2e: ~29ms** (< 800ms; hanya `queue.add`)
- [x] Notifikasi terkirim ke SEMUA ortu APPROVED, tersimpan di `notifications` (type `ATTENDANCE_DONE`) — **e2e**
- [x] Ortu tanpa device token tetap menerima notifikasi **in-app** — **e2e**
- [x] Job gagal tidak memacetkan queue: retry 3× + dead-letter (`removeOnFail:false`) + log — **unit test**
- [x] Idempoten: retry job tidak menduplikasi baris `notifications` — **unit test**
- [x] Badge unread akurat & berkurang saat dibaca (`read` / `read-all`) — **e2e**
- [x] E2E notifikasi vs Postgres+Redis nyata: 20/20 assertion; 63 unit test hijau

### Fase 2.2 (backend)
- [x] Scan `qr_token` valid → student (untuk mobile set HADIR); token asing / nonaktif → 404 `QR_INVALID` — **e2e**
- [x] `qr_token` yang sudah dirotasi **tidak bisa dipakai** untuk presensi (string lama tak cocok) — **e2e**
- [x] Siswa bukan anggota ekskul → 422 `NOT_A_MEMBER`; bukan pembina ekskul → 403 — **e2e**
- [x] E2E QR vs Postgres nyata: 10/10 assertion; 66 unit test hijau; audit `QR_SCAN` + `ROTATE_QR_TOKEN`

### Fase 2.3 (backend)
- [x] Submit **menolak `activeness_score` untuk siswa non-HADIR** → 422 `attendances[i].activeness_score` — **unit + e2e**
- [x] `GET /coach/sessions` menyertakan `avgActiveness` per sesi — **e2e: (5+3)/2 = 4.0**
- [x] 67 unit test hijau

### Fase 2.4 (backend)
- [x] Approve/Reject → `audit_logs` dengan admin yang bertanggung jawab (`approved_by`) — **e2e**
- [x] Ortu yang di-reject tidak bisa mengajukan ulang < 24 jam → 409 dengan sisa jam — **unit + e2e**
- [x] Badge `suspicious` benar: > 5 siswa berbeda / 1 nomor HP / 24 jam → true; 1 pengajuan → false — **unit + e2e**
- [x] Notifikasi push `RELATION_DECISION` (approved/rejected + alasan) terkirim via queue — **e2e (poll `/notifications`)**
- [x] E2E relasi vs Postgres+Redis nyata: 9/9 assertion; 70 unit test hijau

### Fase 3.1 (backend)
- [x] Export 500 siswa **tidak** membuat request timeout — berjalan async via queue — **e2e skala: respons 202 dalam ~23 ms, job selesai ~1 dtk**
- [x] File hasil export tidak bisa diakses tanpa signed URL valid & belum expired — tanpa `sig` → 403, `sig` salah → 403, `expires` dipalsukan → 410, valid → 200 — **e2e**
- [x] Setiap export tercatat di `audit_logs` (`EXPORT_REPORT`) dengan `format` + `filters` (kelas/ekskul/rentang tanggal) — **e2e (cek langsung tabel)**
- [x] PDF (rapor per siswa, pdfkit) & Excel (data mentah, exceljs) — header `%PDF` / `PK` + `Content-Disposition: attachment` diverifikasi — **e2e**
- [x] E2E export vs Postgres+Redis nyata: 25/25 assertion; **95 unit test** hijau (+25 dari 3.1)

### Fase 3.2 (backend)
- [x] `GET /admin/analytics/overview` memuat **< 2 detik untuk data 1 tahun ajaran penuh** — window 8 minggu, uji skala 156k baris detail → ~820 ms uncached, ~11 ms cached — **e2e skala**
- [x] Cache Redis TTL 1 jam: panggilan ke-2 `cached:true` + `generatedAt` sama; `?fresh=1` menghitung ulang — **unit + e2e**
- [x] `attendanceTrend` selalu 8 titik kronologis; minggu tanpa data → 0 (bukan NaN/error) — **unit + e2e**
- [x] `lowAttendanceByExtracurricular` top-5 urut % menaik + diperkaya nama siswa — **unit + e2e**
- [x] Tren keaktifan ortu diagregasi per minggu/bulan (`bucketActivenessTrend`), akurat saat data minim 1 titik — **unit + e2e**
- [x] E2E analitik vs Postgres+Redis nyata: 25/25 assertion; **106 unit test** hijau (+11 dari 3.2)

### Fase 3.3 (backend)
- [x] Job berjalan otomatis sesuai jadwal tanpa intervensi — `@Cron` Minggu 18:00 / tgl 1 06:00 (Asia/Jakarta); logika periode & tren **teruji unit dengan `now` mock** (`period.spec.ts`)
- [x] Retry / cron dobel **tidak** mengirim notifikasi dobel — run-guard Redis + `jobId` deterministik + `dedupeKey` per (periode, siswa); e2e: re-run `force` → jumlah notifikasi tetap
- [x] Beban server stabil untuk skala besar — cron hanya memicu; fan-out → batch 200 + jeda 750 ms; **uji 2.000 siswa: `/auth/me` p95 10 ms selama worker jalan**, 2.000 notifikasi, nol duplikat
- [x] Ringkasan bulanan menyertakan tren vs bulan sebelumnya (`naik`/`turun`/`stabil`) — **unit + e2e (100% vs 50% → naik)**
- [x] Pemicu manual `POST /admin/periodic-reports/run` (`@Roles('ADMIN')`, audit `RUN_PERIODIC_REPORT`)
- [x] E2E berkala vs Postgres+Redis nyata: 15/15 assertion; **123 unit test** hijau (+17 dari 3.3); dep baru `@nestjs/schedule@12`

### Fase 4.1 (backend)
- [x] Interceptor global mencakup **100%** endpoint yang menyentuh data personal siswa/ortu — lihat **checklist cakupan audit** di atas (bukan spot check): 9 read via `@Audit`, sisanya via `audit.log()` service-level yang memang sudah 100%
- [x] `AuditInterceptor` mencatat sukses (`outcome:'success'`) **dan** percobaan gagal (`outcome:'error'` + `statusCode`) — **unit + e2e (404 tetap tercatat)**
- [x] `GET /admin/audit-logs` memfilter < 3 detik untuk log berskala besar — **e2e skala 500 k baris: action+tanggal 52 ms, userId 58 ms, free-text trigram 937 ms, facets 84 ms**
- [x] Free-text search di `metadata` (JSONB) — GIN trigram `idx_audit_metadata_trgm`; juga cocok pada nama/email user — **e2e**
- [x] Halaman audit **read-only** + sub-permission — hanya `ADMIN_SUPER` (403 untuk `ADMIN` biasa), `POST /admin/audit-logs` → 404 — **unit (RolesGuard hierarki) + e2e**
- [x] Migration indeks + `down.sql` terverifikasi (drop bersih → re-apply bersih)
- [x] **136 unit test** hijau (+13 dari 4.1)
