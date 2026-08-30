# Self-Review Keamanan Backend — Fase 4.3

**Tanggal:** 2026-08-30
**Cakupan:** `eskul-backend` (NestJS 12, commit menjelang go-live)
**Tujuan:** baseline sebelum penetration test eksternal. Checklist mengikuti
`ai-prompts-rencana-pengerjaan.md` §4.3.

## Ringkasan

| Severity | Jumlah temuan | Belum diperbaiki |
|---|---|---|
| Critical | 0 | 0 |
| High | 0 *(runtime)* — 3 dependency (CLI/devDep, tidak di jalur runtime) | 0 wajib |
| Medium | 3 (transitive dependency, tidak eksploitabel pada pemakaian kami) | 0 wajib |
| Low / hardening | 5 (semua sudah dikerjakan di fase ini) | 0 |

**DoD terpenuhi:** tidak ada temuan Critical/High yang harus diperbaiki dan belum
diperbaiki sebelum go-live. Dokumen ini menjadi baseline pentest.

---

## 1. Endpoint yang menyentuh data siswa — validasi relasi/otorisasi

**Status: AMAN (diverifikasi, tanpa perubahan).**

- `GET /parent/child-progress/:id` — wajib relasi `parent_student_relations.approval_status='APPROVED'`
  antara `parent.user_id` = user login dan `:id`. Tanpa itu → **403 `{ error: 'UNAUTHORIZED_RELATION' }`**
  di **semua** kasus:
  - ortu dengan relasi ke anak lain → 403 (e2e)
  - ortu tanpa relasi apa pun → 403 (e2e)
  - `:id` UUID acak → 403 (e2e)
- `GET /coach/extracurriculars/:id/roster` & `POST /attendance/submit` &
  `POST /coach/students/qr-scan` — semua mengecek `extracurriculars.default_coach_id === coach.id`
  → coach lain → **403** (e2e).
- `POST /coach/students/qr-scan` — siswa bukan anggota ekskul → **422 `NOT_A_MEMBER`**;
  `qr_token` asing/rotated → **404 `QR_INVALID`** (token acak, **bukan** turunan NIS).
- Semua route `:id` admin memakai `ParseUUIDPipe` (tolak non-UUID sebelum query).
- Unduhan laporan (`/admin/reports/downloads/:id`) **hanya** via signed URL HMAC + `expires`
  (sig salah → 403, kedaluwarsa → 410).
- **Audit**: setiap akses data siswa/ortu tercatat di `audit_logs` (interceptor `@Audit`
  global — Fase 4.1, checklist cakupan 100% di `README.md`).

E2E: `scratchpad/security-smoke.mjs` §1–§2, `parent-smoke.mjs`, `qr-smoke.mjs`.

---

## 2. Rate limiting — anti brute-force

**Status: DIPERBAIKI (fitur baru di fase ini).**

Sebelumnya tidak ada rate limiting (`@nestjs/throttler` belum kompatibel NestJS 12).
Ditambahkan **`RateLimitGuard`** berbasis Redis (fixed-window per-IP, `APP_GUARD` pertama,
`X-RateLimit-*` header, `429 { error: 'RATE_LIMITED', retryAfterSeconds }` + `Retry-After`,
**fail-open** bila Redis mati).

| Endpoint | Batas |
|---|---|
| `POST /auth/login` | 8 / 60 dtk / IP |
| `POST /auth/login/mfa` | 10 / 60 dtk / IP |
| `POST /auth/refresh` | 30 / 60 dtk / IP |
| `POST /auth/register` | 5 / 3600 dtk / IP |
| `POST /auth/mfa/{enable,disable,recovery-codes}` | 10 / 300 dtk / IP |
| `POST /parent/link-request` | 12 / 600 dtk / IP (anti-enumerasi NIS) |
| semua route lain | global 300 / 60 dtk / IP (`RATE_LIMIT_GLOBAL_*`) |
| `GET /health` | `@NoRateLimit()` (untuk LB) |

Diaktifkan via `RATE_LIMIT_ENABLED` (**default `true`**, `.env` dev box `false` agar
smoke regresi lama tetap jalan). E2E `security-smoke.mjs` §6 (dengan `=true`) →
429 + `Retry-After` terverifikasi. Unit: `rate-limit.guard.spec.ts` (6).

**Keterbatasan (follow-up, bukan blocker):** per-IP fixed-window efektif untuk brute-force
satu sumber; brute-force terdistribusi butuh WAF/CDN di depan (di luar cakupan aplikasi).

---

## 3. Kebocoran data sensitif ke log / response

**Status: AMAN (1 perbaikan minor).**

- Tidak ada `console.log`/logger yang menuliskan **password, JWT, refresh token, atau
  data pribadi siswa**. (Audit `grep` seluruh `src`.)
- `LOGIN_FAILED` mencatat `identifier` (email/no HP yang dicoba) + `reason` ke **`audit_logs`**
  (DB, akses `ADMIN_SUPER`) — **bukan** ke console; ini praktik audit keamanan yang benar,
  password tidak pernah ikut.
- `main.ts` hanya `console.log` URL listen.
- **Perbaikan:** `LoggingPushSender` (dev-only) — prefix token yang di-log dipangkas
  `12 → 6` karakter.
- Response: `GET /auth/me` & CRUD siswa **tidak** mengembalikan `password_hash` /
  `mfa_secret` (field di-`select` eksplisit). `GET /auth/mfa/setup` sengaja
  mengembalikan `secret` (dibutuhkan authenticator, dilindungi TLS).
- `ValidationPipe` (`forbidNonWhitelisted: true`) — pesan error `{ field, message }`
  tidak meng-echo nilai input.

E2E `security-smoke.mjs` §5.

---

## 4. Dependency vulnerability scan (`npm audit`)

**Status: TIDAK ADA yang eksploitabel di jalur runtime. 0 fix wajib.**

`npm audit`: **10 (7 moderate, 3 high)** — seluruhnya transitive; `npm audit fix`
(non-breaking) tidak menghapus satu pun (perlu perubahan mayor).

| Advisory | Rantai | Analisis | Status |
|---|---|---|---|
| **HIGH** `deepmerge-ts` stack exhaustion (GHSA-ggr8-5vv4-36mx) | `prisma` (devDep) → `@prisma/config` → `deepmerge-ts@7` | Hanya **Prisma CLI** (build/migrate), **bukan** `@prisma/client` runtime. Hanya terpicu saat merge objek rekursif dari **config lokal tepercaya**, bukan input penyerang. Prisma 6.x terbaru (6.19.3) masih membundel versi ini — **tidak ada fix non-breaking**. | **Accepted** — pantau Prisma 7 / patch 6.x. Tercatat juga di README "utang teknis". |
| **MOD** `uuid` missing buffer bounds check (GHSA-w5hq-g745-h8pq) | `exceljs` → `uuid@8`; `firebase-admin` → `@google-cloud/*` → `uuid` | Hanya bila arg `buf` diberikan ke `uuid.v3/v5/v6`. Dependensi kami memanggil `uuid.v4()` **tanpa** `buf`. Tidak dapat dieksploitasi. Fix = downgrade mayor `exceljs@3`. | **Accepted** |
| **MOD** `firebase-admin` → `@google-cloud/storage` (retry-request / teeny-request) | `firebase-admin@14` | Kami hanya memakai **FCM messaging**, tidak GCS. `firebase-admin` **lazy-loaded**, hanya aktif bila `FCM_CREDENTIALS_PATH` menunjuk file nyata (tidak di dev/CI). | **Accepted / mitigated** — pin/patch saat FCM produksi diaktifkan. |

**Rekomendasi go-live:** jalankan `npm audit` di pipeline sebagai *warning* (bukan gate),
dan buat tiket untuk upgrade Prisma 7 + firebase-admin patch.

---

## 5. HTTPS-only & HSTS

**Status: DIHARDENING.**

- Aplikasi berjalan **di belakang API Gateway/LB** yang melakukan terminasi TLS
  (dokumen desain §1.1). `app.set('trust proxy', 1)` → `req.ip` = IP klien.
- `helmet()` di-konfigurasi eksplisit:
  - **`Strict-Transport-Security: max-age=15552000; includeSubDomains; preload`** (180 hari)
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: no-referrer`
  - `Cross-Origin-Resource-Policy: same-site`
  - `contentSecurityPolicy` dimatikan (API JSON murni, CSP tak relevan)
  - `X-Powered-By` dihapus (`app.disable('x-powered-by')`)
- Redirect HTTP→HTTPS adalah tanggung jawab gateway (bukan app).

E2E `security-smoke.mjs` §3.

---

## 6. CORS

**Status: DIHARDENING.**

- Origin **hanya** dari `CORS_ALLOWED_ORIGINS` (csv, mis. `https://admin.sekolah.sch.id`).
  Default dev: `http://localhost:5273`.
- **Wildcard `*` ditolak**: di `production` → app gagal start; selain itu → warning + diabaikan.
  (Tidak boleh `*` + `credentials: true`.)
- `credentials: true`, `methods` eksplisit, `maxAge: 600`.
- Origin resmi di-echo di `Access-Control-Allow-Origin`; origin asing → tidak ada header
  (browser memblokir). Diverifikasi e2e `security-smoke.mjs` §4.
- **Aplikasi mobile** memakai HTTP client native (tanpa header `Origin`) → CORS tidak
  berlaku untuknya; otorisasi tetap via JWT. Deep-link config ada di sisi mobile.

---

## Kontrol keamanan lain (sudah ada, diverifikasi — tanpa perubahan)

- Password **argon2id**; pesan login gagal **generik** (tak bocorkan email vs password).
- JWT access 15 mnt + refresh token **allow-list di Redis** (rotasi tiap refresh; logout
  mencabut semua sesi).
- **MFA TOTP** untuk admin (Fase 4.2): login 2 langkah, anti-replay via `mfa_last_counter`,
  recovery code sekali-pakai (hash argon2id), `MfaGuard` memblok admin tanpa MFA.
- **RBAC** guard global + hierarki `ADMIN_SUPER ⊃ ADMIN`; halaman audit khusus `ADMIN_SUPER`.
- `ValidationPipe` global `whitelist + forbidNonWhitelisted + transform`.
- Body error 422/400 terstruktur, tidak membocorkan stack/detail internal.

## Follow-up (non-blocker)

1. Upgrade **Prisma 7** (menghapus `deepmerge-ts` HIGH) & patch **firebase-admin** saat FCM produksi aktif.
2. Evaluasi **httpOnly cookie** untuk refresh token vs `localStorage` di web-admin
   (saat ini kompromi dev — dicatat di `web-admin/README.md` & `authStore.ts`).
3. WAF/CDN rate-limit terdistribusi di depan gateway.
4. Set **`MFA_ENFORCE_ADMIN=true`** dan **`RATE_LIMIT_ENABLED=true`** di lingkungan
   nyata (default `.env.example` sudah `true`; hanya `.env` dev box yang `false`).
5. Rotasi berkala `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` / `REPORT_SIGNING_SECRET`.
