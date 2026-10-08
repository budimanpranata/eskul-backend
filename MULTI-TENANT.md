# Kesiapan Multi-Tenant — Evaluasi & Rencana Migrasi (Fase 4.4 → diimplementasikan beyond-plan)

**Requirement** (`system-design` §1.2): "Mendukung multi-sekolah (multi-tenant ready)
hingga 5.000 siswa & 200 ekskul **per instance**."

> Catatan rencana kerja §4.4: *"evaluasi dan implementasikan strategi tenant isolation
> … diskusikan trade-off shared-database vs database-per-tenant **sebelum implementasi**."*
> Dokumen ini adalah diskusi tersebut. **Status implementasi: Strategi A (§2) SUDAH
> DIKERJAKAN** (lihat §4) — ADMIN_SUPER mendaftarkan sekolah, setiap sekolah
> terisolasi penuh dari sekolah lain.

## 1. Pilihan arsitektur

| Strategi | Isolasi | Ops (banyak sekolah kecil) | Migrasi skema | Query lintas-sekolah (analitik dinas) | Biaya |
|---|---|---|---|---|---|
| **A. Shared DB + `school_id`** | Logis (filter di app + opsional Postgres RLS) | **Termudah** — 1 DB, 1 pipeline migrasi | 1× jalan | Mudah (agregasi 1 query) | **Terendah** |
| B. Shared DB, schema-per-tenant | Menengah (schema Postgres terpisah) | Sedang — `search_path` per request, N schema | N× (per schema) | Sulit (UNION lintas schema) | Menengah |
| C. Database-per-tenant | **Terkuat** (fisik) | Berat — N DB, N koneksi pool, N backup | N× | Sangat sulit | Tertinggi |

**Konteks proyek**: sekolah dasar, data per instance kecil (≤ 5.000 siswa), banyak
sekolah "kecil" dalam satu deployment dinas pendidikan, kebutuhan agregasi lintas
sekolah (laporan dinas), tim ops kecil.

### Rekomendasi: **Strategi A — shared database + `school_id` + filter row-level otomatis.**

- Meets NFR (5.000 siswa/instance jauh di bawah batas 1 DB Postgres).
- Satu pipeline migrasi/seed/backup — cocok untuk tim kecil.
- Isolasi ditegakkan **berlapis**: (1) middleware/extension aplikasi menyuntik
  `WHERE school_id = <tenant>` ke setiap query; (2) opsional **Postgres Row-Level
  Security** sebagai defense-in-depth (`current_setting('app.school_id')`).
- Upgrade ke B/C bisa dilakukan belakangan **per-sekolah** (tarik `school_id` → DB baru)
  tanpa mengubah kode aplikasi bila abstraksi tenant sudah rapi.

## 2. Rencana migrasi bertahap (non-breaking)

Semua langkah kompatibel dengan data & test single-tenant yang ada (satu sekolah default).

1. **Skema** — migration `add_schools`:
   - Tabel `schools (id, code UNIQUE, name, is_active, created_at)`.
   - Kolom `school_id UUID NULL` + FK di **tabel root-owned**: `users`, `students`,
     `extracurriculars`. (Tabel anak — `attendance_*`, `extracurricular_*`,
     `parent_student_relations`, `notifications`, `report_exports` — mewarisi tenancy
     lewat FK ke parent; tidak perlu `school_id` sendiri untuk mencegah kebocoran.)
   - Index `(school_id)` pada ketiga tabel.
2. **Backfill** — buat 1 baris `schools` default (`SD-DEFAULT`), `UPDATE … SET school_id = <default>`
   untuk seluruh baris lama, lalu `ALTER COLUMN school_id SET NOT NULL`.
3. **Klaim JWT** — `AccessTokenPayload.sch` (school id) diisi saat login dari `user.school_id`;
   `AuthenticatedUser.schoolId`. Registrasi ortu memakai `school_id` siswa yang di-link.
4. **Konteks tenant** — `AsyncLocalStorage<{ schoolId }>` + `TenantInterceptor` global
   yang menjalankan handler di dalam `als.run({ schoolId: req.user.schoolId }, next)`.
   Route `@Public()` / lintas-tenant (`ADMIN_SUPER` dinas) → konteks kosong = tanpa filter.
5. **Enforcement otomatis** — Prisma **client extension** (`$extends({ query: { … } })`):
   untuk model `user`/`student`/`extracurricular`, bila konteks ALS ada → sisipkan
   `args.where = { AND: [args.where, { schoolId }] }` pada `findMany/findFirst/findUnique/
   count/aggregate/updateMany/deleteMany`, dan `args.data.schoolId = schoolId` pada `create`.
   `findUnique` by id tetap difilter → 404 lintas-sekolah, bukan kebocoran.
6. **RLS (opsional, defense-in-depth)** — `ALTER TABLE … ENABLE ROW LEVEL SECURITY` +
   policy `USING (school_id = current_setting('app.school_id')::uuid)`; set GUC per koneksi
   di `PrismaService` `$on('query')` / middleware.
7. **Seed** — `schools` default + admin per sekolah; `superadmin@` tetap lintas-tenant.
8. **Test** — e2e: buat sekolah B (admin + siswa sendiri); pastikan admin A `GET
   /admin/students` **tidak** memuat siswa B, `GET /admin/students/:idB` → 404, submit/
   relasi lintas-sekolah → 403/404. Unit: extension menyuntik filter saat ALS aktif,
   tidak menyuntik saat kosong.

## 3. Trade-off & risiko yang disepakati

- **Risiko**: client extension yang salah = kebocoran senyap → wajib test isolasi
  menyeluruh + RLS sebagai jaring pengaman.
- **Nested writes** Prisma (`create` dengan relasi bersarang) perlu perhatian khusus
  agar `school_id` anak konsisten — mitigasi: tabel anak tanpa `school_id`, tenancy via FK.
- **Blast radius**: menyentuh JWT, guard chain, hampir semua query → dikerjakan sebagai
  migrasi terjadwal tersendiri dengan window uji regresi penuh (bukan diselipkan di 4.4).

## 4. Status

**Strategi A (shared DB + `school_id`) di §2 — IMPLEMENTED** (migration
`20260831000000_add_schools`). Beda dari rencana asli di §2 dalam dua hal sadar,
demi kesederhanaan & keamanan yang lebih mudah diaudit:

- **Tanpa `AsyncLocalStorage` + Prisma client extension otomatis.** Setiap
  controller memanggil `tenantScope(user)` (`common/types/authenticated-user.ts`)
  secara eksplisit dan meneruskannya ke service sebagai parameter biasa — konsisten
  dengan gaya proyek ini (pengecekan otorisasi eksplisit per-service, bukan middleware
  tersembunyi) dan lebih mudah di-review per baris ketimbang query yang "disuntik" diam-diam.
- **`school_id` hanya di 3 tabel root** (`users`, `students`, `extracurriculars`)
  sesuai rencana awal — tabel anak (`attendance_*`, `extracurricular_members`,
  `parent_student_relations`, dst.) tetap mewarisi tenancy lewat FK + validasi
  eksplisit (mis. `assertNoScheduleClash` kini discope per `schoolId`, `addMembers`
  memvalidasi siswa dari sekolah yang sama, dataset laporan/analitik difilter
  lewat relasi `extracurricular.schoolId` / `student.schoolId`).

**`tenantScope(user)`**: `undefined` (tanpa filter, lintas-sekolah) **HANYA**
untuk `ADMIN_SUPER` (operator platform) — ini **disengaja**, bukan lubang
keamanan: `ADMIN_SUPER` adalah peran yang mendaftarkan sekolah & punya keperluan
oversight lintas-tenant. `ADMIN`/`PEMBINA` selalu mendapat `user.schoolId` eksak
(atau sentinel UUID yang tak pernah cocok apa pun bila entah bagaimana kosong —
fail-closed, bukan fail-open).

**Modul baru `schools`** (`src/modules/schools/`, `@Roles('ADMIN_SUPER')`,
`/admin/schools`): `POST` mendaftarkan sekolah + admin pertamanya dalam satu
transaksi, `POST /:id/admins` menambah admin lain, `POST /:id/suspend|resume`
(sekolah disuspend → `AuthService.login`/`refresh` menolak **semua** ADMIN/PEMBINA
sekolah itu walau `user.is_active=true`), `GET`/`PUT` list & detail.

**NIS kini unik PER SEKOLAH** (`UNIQUE(school_id, nis)`, bukan global) — konsekuensi:
`POST /parent/link-request` (self-serve & mobile) sekarang **wajib** `schoolCode`
untuk disambiguasi sebelum mencari siswa by NIS; `web-admin` & mobile app (Flutter
`LinkChildPage`) sudah diperbarui.

**Terverifikasi end-to-end** (`scratchpad/tenant-smoke.mjs`, 28/28 assertion vs
Postgres+Redis nyata): ADMIN_SUPER mendaftarkan Sekolah B + admin; admin Sekolah A
**tidak bisa** — lewat list ATAU akses-by-id langsung (404, bukan 403, agar tak
membocorkan keberadaan baris) — melihat siswa/pembina/ekskul Sekolah B; katalog
ekskul (cache Redis) ter-scope per sekolah; analytics overview & reports preview
Sekolah A tidak menyebut data Sekolah B; parent link-request butuh `schoolCode`
yang benar; admin Sekolah A tidak bisa approve relasi ortu↔siswa Sekolah B; sekolah
yang disuspend langsung menolak login adminnya, resume mengembalikannya.

**Belum dikerjakan** (di luar scope saat ini, bisa menyusul): pendaftaran sekolah
mandiri tanpa ADMIN_SUPER (self-serve signup), konsol operator terpusat (UI khusus
lintas-sekolah di luar `web-admin`'s "Kelola Sekolah"), tagihan/billing, Postgres
Row-Level Security sebagai defense-in-depth tambahan (§2 langkah 6 — aplikasi
sudah fail-closed tanpa RLS, tapi RLS tetap nilai tambah untuk kasus bug di masa depan).

**Model 1 ("satu deployment per sekolah", `scripts/`)** tetap tersedia sebagai
opsi ops terpisah untuk distribusi lewat dinas yang ingin isolasi fisik penuh —
lihat [`scripts/README.md`](scripts/README.md). Kedua model bisa dipakai sesuai
kebutuhan: Strategi A untuk SaaS shared-infra, Model 1 untuk deployment terisolasi.
