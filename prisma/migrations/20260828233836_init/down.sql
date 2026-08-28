-- Rollback manual untuk migration `20260828233836_init`.
--
-- Prisma Migrate tidak punya perintah "revert per-migration" seperti TypeORM.
-- Cara rollback yang didukung:
--   (a) Development  : `npm run prisma:reset`  (drop semua + re-apply + seed)
--   (b) Manual/audit : jalankan file ini —
--       psql "$DATABASE_URL" -f prisma/migrations/20260828233836_init/down.sql
--
-- Urutan drop = kebalikan dependency FK. CASCADE dipakai sebagai pengaman.

DROP TABLE IF EXISTS "audit_logs" CASCADE;
DROP TABLE IF EXISTS "notifications" CASCADE;
DROP TABLE IF EXISTS "attendance_details" CASCADE;
DROP TABLE IF EXISTS "attendance_sessions" CASCADE;
DROP TABLE IF EXISTS "extracurricular_members" CASCADE;
DROP TABLE IF EXISTS "extracurricular_schedules" CASCADE;
DROP TABLE IF EXISTS "extracurriculars" CASCADE;
DROP TABLE IF EXISTS "parent_student_relations" CASCADE;
DROP TABLE IF EXISTS "parents" CASCADE;
DROP TABLE IF EXISTS "students" CASCADE;
DROP TABLE IF EXISTS "coaches" CASCADE;
DROP TABLE IF EXISTS "users" CASCADE;
DROP TABLE IF EXISTS "roles" CASCADE;

-- Extension dibiarkan (pgcrypto bisa dipakai objek lain). Hapus manual bila perlu:
-- DROP EXTENSION IF EXISTS "pgcrypto";
