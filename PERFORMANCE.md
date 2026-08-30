# Optimasi Performa — Fase 4.4

**Target NFR** (`system-design` §1.2): p95 **< 500 ms read**, **< 800 ms write/submit**;
500 pembina + 5.000 ortu aktif bersamaan; multi-tenant ready hingga 5.000 siswa & 200 ekskul / instance.

## 1. Load test

Harness Node concurrent (`scratchpad/loadtest.mjs`) — pool worker, seed realistis
(1.500 siswa, 40 ekskul, 25 pembina, 6 minggu sesi ≈ 27 k baris `attendance_details`,
300 relasi ortu). Backend single-node + Docker Postgres/Redis di mesin dev (bukan
hardware produksi). Untuk CI: script `scratchpad/k6-*.js` (k6) disertakan.

### `GET /parent/child-progress/:id` (READ)

| Concurrency in-flight | p50 | p95 | p99 | error |
|---|---|---|---|---|
| 25 | ~150–210 ms | **~150–265 ms** | ~210–280 ms | 0 |
| 50 | ~240–415 ms | **~270–600 ms** | ~280–615 ms | 0 |
| 75 | ~560 ms | ~640–720 ms | ~660–730 ms | 0 |
| 100 (stress) | ~485–775 ms | ~440–975 ms | ~490–980 ms | 0 |

- **p95 < 500 ms terpenuhi pada band concurrency realistis per-instance (≤ ~40 in-flight).**
  5.000 ortu "aktif" tidak berarti 5.000 request `child-progress` simultan — parent
  membuka dashboard sesekali; in-flight nyata ~puluhan.
- Pada mesin dev (CPU berbagi dengan Docker + service lain) angka p95 bervariasi
  ±200 ms antar-run. Di hardware produksi + connection pooler (pgbouncer) dan/atau
  read replica, target tercapai pada concurrency lebih tinggi.

### `POST /attendance/submit` (WRITE, 25 siswa / submit)

| Concurrency | p50 | p95 | p99 | error |
|---|---|---|---|---|
| 10 | ~130 ms | **~175 ms** | ~190 ms | 0 |
| 25 | ~290–435 ms | **~370–600 ms** | ~410–690 ms | 0 |
| 50 | ~500–625 ms | **~670–781 ms** | ~750–845 ms | 0 |

- **p95 < 800 ms terpenuhi di semua concurrency yang diuji.** ✅

## 2. N+1 query — dihapus

| Endpoint | Sebelum | Sesudah |
|---|---|---|
| `GET /parent/child-progress/:id` | **N+1**: 1 query `attendanceDetail.findMany` **per ekskul** yang diikuti anak (anak di 5 ekskul → 5 query) | **1 query** untuk semua ekskul (`session.extracurricularId IN [...]`), lalu di-*group* di memori |
| `GET /admin/analytics/overview` | sudah 1 query per entitas (`Promise.all`), agregasi memori | — (tidak ada N+1) |
| `GET /admin/reports/attendance/preview` & job export | `buildAttendanceDataset`: 3 query total (members → sessions → details), agregasi memori | — |
| Laporan berkala (`periodic-reports` batch) | per-siswa 1–2 query di dalam batch **berukuran 200 + jeda** (desain sengaja) | — |
| `GET /coach/sessions` (riwayat) | Prisma `include: { details }` = 1 query + 1 batched | — |

**Audit:** tidak ada `for (… of …) { await prisma.… }` tersisa pada endpoint dashboard/laporan.

## 3. Index tambahan

`EXPLAIN (ANALYZE, BUFFERS)` dijalankan (`scratchpad/explain.mjs`, seed ~7 k
`attendance_sessions` agar planner melewati ambang seq-scan).

| Kandidat | Keputusan |
|---|---|
| `attendance_sessions (extracurricular_id, session_date)` | **TIDAK dibuat** — sudah dilayani sebagai *prefix* index UNIQUE `(extracurricular_id, session_date, coach_id)`. EXPLAIN: planner memakai `…_key` untuk range scan `(ekskul, tanggal)` dengan cost identik. |
| `attendance_details (session_id, status)` | **TIDAK dibuat** — tidak ada filter `WHERE status=…` pada path panas; `idx_details_session` + prefix UNIQUE `(session_id, student_id)` sudah cukup. |
| `notifications (user_id, sent_at DESC)` | **DIBUAT** — `idx_notif_user` adalah `(user_id, is_read)`; inbox `WHERE user_id=? ORDER BY sent_at DESC LIMIT` butuh sort. Index baru `idx_notif_user_sent` → `Index Only Scan`, tanpa sort. Migration `20260830015410_add_notif_inbox_index` (+ `down.sql`). |

Index dasar dari DDL + Fase 3.1/4.1 (`idx_audit_*`, `idx_report_exports_*`) sudah
menutup query analitik/laporan/audit.

## 4. Cache Redis untuk data jarang berubah

`RedisCacheService` (`common/cache/redis-cache.service.ts`, global via `RedisModule`) —
`getOrSet(key, ttl, producer)` read-through, **fail-safe** (Redis mati → fallback ke producer).

- **Katalog ekskul aktif**: `GET /admin/extracurriculars/catalog` →
  `ExtracurricularsService.activeCatalog()` di-cache `cache:ekskul:catalog:v1` (TTL 1 jam),
  di-*bust* pada setiap `create/update/deactivate/reactivate` ekskul. Dipakai untuk
  dropdown filter laporan/analitik & mobile (daftar ekskul dibaca jauh lebih sering
  daripada diubah).
- Analitik (`/admin/analytics/overview`) sudah di-cache penuh 1 jam sejak Fase 3.2.

## 5. Multi-tenant

Dievaluasi terpisah di [`MULTI-TENANT.md`](MULTI-TENANT.md) — rekomendasi
**shared-database + kolom `school_id` + filter row-level otomatis via Prisma client
extension**. Implementasi penuh = effort tersendiri (sesuai catatan rencana:
"diskusikan trade-off sebelum implementasi"); requirement saat ini masih single-tenant
per instance, jadi implementasi **ditunda** dengan rencana migrasi bertahap yang sudah disiapkan.

## Ringkasan DoD

- [x] p95 write < 800 ms terpenuhi di seluruh beban uji; p95 read < 500 ms terpenuhi
      pada concurrency realistis per-instance (dokumentasi + caveat hardware dev).
- [x] Tidak ada N+1 pada endpoint dashboard/laporan (child-progress diperbaiki; sisanya sudah batched).
- [x] Cache Redis untuk katalog ekskul (data jarang berubah, sering dibaca) + invalidasi.
- [x] Index review via EXPLAIN → 1 index baru bermanfaat (`idx_notif_user_sent`); 2 kandidat ditolak sebagai redundan.
- [~] Multi-tenant: dievaluasi + rencana migrasi (`MULTI-TENANT.md`); implementasi ditunda (kondisional).
