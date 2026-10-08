-- Rollback 20260831000000_add_schools

ALTER TABLE "extracurriculars" DROP CONSTRAINT "extracurriculars_school_id_fkey";
DROP INDEX "idx_ekskul_school";
ALTER TABLE "extracurriculars" DROP COLUMN "school_id";

ALTER TABLE "students" DROP CONSTRAINT "students_school_id_fkey";
DROP INDEX "idx_students_school";
DROP INDEX "students_school_id_nis_key";
CREATE UNIQUE INDEX "students_nis_key" ON "students"("nis");
ALTER TABLE "students" DROP COLUMN "school_id";

ALTER TABLE "users" DROP CONSTRAINT "users_school_id_fkey";
DROP INDEX "idx_users_school";
ALTER TABLE "users" DROP COLUMN "school_id";

DROP TABLE "schools";
