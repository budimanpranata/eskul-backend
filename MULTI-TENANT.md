# Kesiapan Multi-Tenant — Evaluasi & Rencana Migrasi (Fase 4.4)

**Requirement** (`system-design` §1.2): "Mendukung multi-sekolah (multi-tenant ready)
hingga 5.000 siswa & 200 ekskul **per instance**."

> Catatan rencana kerja §4.4: *"evaluasi dan implementasikan strategi tenant isolation
> … diskusikan trade-off shared-database vs database-per-tenant **sebelum implementasi**."*
> Dokumen ini adalah diskusi tersebut. Status implementasi: **ditunda** (lihat akhir).

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

**Ditunda.** Requirement aktif = single-tenant per instance (deployment 1 sekolah / 1 dinas
kecil). Skema & kode saat ini **sudah "multi-tenant ready"** dalam arti: abstraksi
repository terpusat di service, `AuthenticatedUser` mudah diperluas, tidak ada query
mentah tersebar. Rencana di §2 siap dieksekusi saat kebutuhan multi-sekolah nyata muncul.
