-- ============================================
-- EXTENSION (sesuai DDL: system-design-ekosistem-ekskul-sd.md bagian 3.2)
-- ============================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- untuk gen_random_uuid()

-- CreateTable
CREATE TABLE "roles" (
    "id" SMALLSERIAL NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(50) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "role_id" SMALLINT NOT NULL,
    "full_name" VARCHAR(150) NOT NULL,
    "email" VARCHAR(150),
    "phone_number" VARCHAR(20),
    "password_hash" TEXT NOT NULL,
    "avatar_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coaches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "employee_number" VARCHAR(30),
    "specialization" VARCHAR(100),
    "bio" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coaches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nis" VARCHAR(30) NOT NULL,
    "full_name" VARCHAR(150) NOT NULL,
    "class_grade" VARCHAR(20) NOT NULL,
    "gender" CHAR(1),
    "date_of_birth" DATE,
    "photo_url" TEXT,
    "qr_token" VARCHAR(64) NOT NULL,
    "qr_token_rotated_at" TIMESTAMPTZ(6),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "relation_type" VARCHAR(20) NOT NULL,
    "identity_verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parent_student_relations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "parent_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "is_primary_contact" BOOLEAN NOT NULL DEFAULT false,
    "approval_status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parent_student_relations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extracurriculars" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(100) NOT NULL,
    "category" VARCHAR(50),
    "description" TEXT,
    "default_coach_id" UUID,
    "max_capacity" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extracurriculars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extracurricular_schedules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "extracurricular_id" UUID NOT NULL,
    "day_of_week" SMALLINT NOT NULL,
    "start_time" TIME(6) NOT NULL,
    "end_time" TIME(6) NOT NULL,
    "location" VARCHAR(100),
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "extracurricular_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extracurricular_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "extracurricular_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "joined_date" DATE NOT NULL DEFAULT CURRENT_DATE,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "extracurricular_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "extracurricular_id" UUID NOT NULL,
    "coach_id" UUID NOT NULL,
    "schedule_id" UUID,
    "session_date" DATE NOT NULL,
    "start_time" TIME(6),
    "end_time" TIME(6),
    "location" VARCHAR(100),
    "material_description" TEXT,
    "duration_minutes" INTEGER,
    "target_achievement" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "client_generated_id" UUID,
    "submitted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_details" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "status" VARCHAR(10) NOT NULL,
    "activeness_score" SMALLINT,
    "skill_notes" TEXT,
    "personal_notes" TEXT,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "body" TEXT,
    "payload" JSONB,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "sent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "user_id" UUID,
    "action" VARCHAR(50) NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" UUID,
    "ip_address" INET,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_number_key" ON "users"("phone_number");

-- CreateIndex
CREATE INDEX "idx_users_role" ON "users"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "coaches_user_id_key" ON "coaches"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "coaches_employee_number_key" ON "coaches"("employee_number");

-- CreateIndex
CREATE UNIQUE INDEX "students_nis_key" ON "students"("nis");

-- CreateIndex
CREATE UNIQUE INDEX "students_qr_token_key" ON "students"("qr_token");

-- CreateIndex
CREATE INDEX "idx_students_class" ON "students"("class_grade");

-- CreateIndex
CREATE INDEX "idx_students_qr" ON "students"("qr_token");

-- CreateIndex
CREATE UNIQUE INDEX "parents_user_id_key" ON "parents"("user_id");

-- CreateIndex
CREATE INDEX "idx_psr_student" ON "parent_student_relations"("student_id");

-- CreateIndex
CREATE INDEX "idx_psr_status" ON "parent_student_relations"("approval_status");

-- CreateIndex
CREATE UNIQUE INDEX "parent_student_relations_parent_id_student_id_key" ON "parent_student_relations"("parent_id", "student_id");

-- CreateIndex
CREATE INDEX "idx_schedule_ekskul" ON "extracurricular_schedules"("extracurricular_id");

-- CreateIndex
CREATE INDEX "idx_member_student" ON "extracurricular_members"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "extracurricular_members_extracurricular_id_student_id_key" ON "extracurricular_members"("extracurricular_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_sessions_client_generated_id_key" ON "attendance_sessions"("client_generated_id");

-- CreateIndex
CREATE INDEX "idx_sessions_date" ON "attendance_sessions"("session_date");

-- CreateIndex
CREATE INDEX "idx_sessions_coach" ON "attendance_sessions"("coach_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_sessions_extracurricular_id_session_date_coach_i_key" ON "attendance_sessions"("extracurricular_id", "session_date", "coach_id");

-- CreateIndex
CREATE INDEX "idx_details_student" ON "attendance_details"("student_id");

-- CreateIndex
CREATE INDEX "idx_details_session" ON "attendance_details"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_details_session_id_student_id_key" ON "attendance_details"("session_id", "student_id");

-- CreateIndex
CREATE INDEX "idx_notif_user" ON "notifications"("user_id", "is_read");

-- CreateIndex
CREATE INDEX "idx_audit_user" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "idx_audit_entity" ON "audit_logs"("entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "coaches" ADD CONSTRAINT "coaches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "parents" ADD CONSTRAINT "parents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "parent_student_relations" ADD CONSTRAINT "parent_student_relations_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "parents"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "parent_student_relations" ADD CONSTRAINT "parent_student_relations_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "parent_student_relations" ADD CONSTRAINT "parent_student_relations_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "extracurriculars" ADD CONSTRAINT "extracurriculars_default_coach_id_fkey" FOREIGN KEY ("default_coach_id") REFERENCES "coaches"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "extracurricular_schedules" ADD CONSTRAINT "extracurricular_schedules_extracurricular_id_fkey" FOREIGN KEY ("extracurricular_id") REFERENCES "extracurriculars"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "extracurricular_members" ADD CONSTRAINT "extracurricular_members_extracurricular_id_fkey" FOREIGN KEY ("extracurricular_id") REFERENCES "extracurriculars"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "extracurricular_members" ADD CONSTRAINT "extracurricular_members_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_extracurricular_id_fkey" FOREIGN KEY ("extracurricular_id") REFERENCES "extracurriculars"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "coaches"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "extracurricular_schedules"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "attendance_details" ADD CONSTRAINT "attendance_details_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "attendance_sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "attendance_details" ADD CONSTRAINT "attendance_details_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ============================================
-- CHECK CONSTRAINTS
-- Tidak dapat dinyatakan di schema Prisma; ditambahkan manual agar identik
-- dengan DDL asli (system-design-ekosistem-ekskul-sd.md bagian 3.2).
-- ============================================
ALTER TABLE "students"
    ADD CONSTRAINT "students_gender_check" CHECK ("gender" IN ('L', 'P'));

ALTER TABLE "extracurricular_schedules"
    ADD CONSTRAINT "extracurricular_schedules_day_of_week_check" CHECK ("day_of_week" BETWEEN 1 AND 7);

ALTER TABLE "attendance_details"
    ADD CONSTRAINT "attendance_details_status_check" CHECK ("status" IN ('HADIR', 'IZIN', 'SAKIT', 'ALPA'));

ALTER TABLE "attendance_details"
    ADD CONSTRAINT "attendance_details_activeness_score_check" CHECK ("activeness_score" BETWEEN 1 AND 5);
