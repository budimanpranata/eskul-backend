-- ============================================
-- MULTI-TENANT (Strategi A — shared DB + school_id)
-- Lihat ../../MULTI-TENANT.md §2 untuk rencana lengkap.
-- Non-breaking: kolom ditambah NULLABLE dulu, dibackfill ke satu sekolah
-- default, baru di-NOT NULL-kan (students/extracurriculars).
-- ============================================

-- CreateTable
CREATE TABLE "schools" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schools_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "schools_code_key" ON "schools"("code");

-- Sekolah default untuk membackfill seluruh data single-tenant yang sudah ada.
INSERT INTO "schools" ("code", "name") VALUES ('SD-DEFAULT', 'Sekolah Default');

-- ============================================
-- users.school_id — NULLABLE (hanya ADMIN/PEMBINA; ORANGTUA & ADMIN_SUPER tetap NULL)
-- ============================================
ALTER TABLE "users" ADD COLUMN "school_id" UUID;

UPDATE "users" u
SET "school_id" = (SELECT "id" FROM "schools" WHERE "code" = 'SD-DEFAULT')
WHERE u."role_id" IN (SELECT "id" FROM "roles" WHERE "code" IN ('ADMIN', 'PEMBINA'));

CREATE INDEX "idx_users_school" ON "users"("school_id");

ALTER TABLE "users" ADD CONSTRAINT "users_school_id_fkey"
    FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ============================================
-- students.school_id — backfill lalu NOT NULL; nis jadi unik PER SEKOLAH
-- ============================================
ALTER TABLE "students" ADD COLUMN "school_id" UUID;

UPDATE "students"
SET "school_id" = (SELECT "id" FROM "schools" WHERE "code" = 'SD-DEFAULT');

ALTER TABLE "students" ALTER COLUMN "school_id" SET NOT NULL;

DROP INDEX "students_nis_key";
CREATE UNIQUE INDEX "students_school_id_nis_key" ON "students"("school_id", "nis");
CREATE INDEX "idx_students_school" ON "students"("school_id");

ALTER TABLE "students" ADD CONSTRAINT "students_school_id_fkey"
    FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ============================================
-- extracurriculars.school_id — backfill lalu NOT NULL
-- ============================================
ALTER TABLE "extracurriculars" ADD COLUMN "school_id" UUID;

UPDATE "extracurriculars"
SET "school_id" = (SELECT "id" FROM "schools" WHERE "code" = 'SD-DEFAULT');

ALTER TABLE "extracurriculars" ALTER COLUMN "school_id" SET NOT NULL;

CREATE INDEX "idx_ekskul_school" ON "extracurriculars"("school_id");

ALTER TABLE "extracurriculars" ADD CONSTRAINT "extracurriculars_school_id_fkey"
    FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
