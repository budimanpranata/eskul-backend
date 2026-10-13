-- CreateTable
CREATE TABLE "billing_invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "student_id" UUID NOT NULL,
    "extracurricular_id" UUID,
    "period" VARCHAR(20) NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "amount" INTEGER NOT NULL,
    "due_date" DATE,
    "status" VARCHAR(20) NOT NULL DEFAULT 'UNPAID',
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_id" UUID NOT NULL,
    "method" VARCHAR(20) NOT NULL,
    "amount" INTEGER NOT NULL,
    "proof_key" TEXT,
    "note" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "submitted_by" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified_by" UUID,
    "verified_at" TIMESTAMPTZ(6),
    "rejection_reason" TEXT,

    CONSTRAINT "billing_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_invoices_student" ON "billing_invoices"("student_id");

-- CreateIndex
CREATE INDEX "idx_invoices_ekskul" ON "billing_invoices"("extracurricular_id");

-- CreateIndex
CREATE INDEX "idx_invoices_status" ON "billing_invoices"("status");

-- CreateIndex
CREATE INDEX "idx_invoices_period" ON "billing_invoices"("period");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_student_ekskul_period_key" ON "billing_invoices"("student_id", "extracurricular_id", "period");

-- CreateIndex
CREATE INDEX "idx_payments_invoice" ON "billing_payments"("invoice_id");

-- CreateIndex
CREATE INDEX "idx_payments_status" ON "billing_payments"("status");

-- AddForeignKey
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_extracurricular_id_fkey" FOREIGN KEY ("extracurricular_id") REFERENCES "extracurriculars"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "billing_payments" ADD CONSTRAINT "billing_payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "billing_invoices"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "billing_payments" ADD CONSTRAINT "billing_payments_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "billing_payments" ADD CONSTRAINT "billing_payments_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ============================================
-- CHECK CONSTRAINTS (tidak bisa dinyatakan di schema Prisma — lihat konvensi
-- yang sama di migration 20260828233836_init)
-- ============================================
ALTER TABLE "billing_invoices"
    ADD CONSTRAINT "billing_invoices_status_check" CHECK ("status" IN ('UNPAID', 'PENDING_VERIFICATION', 'PAID', 'CANCELLED'));

ALTER TABLE "billing_payments"
    ADD CONSTRAINT "billing_payments_method_check" CHECK ("method" IN ('TRANSFER', 'CASH'));

ALTER TABLE "billing_payments"
    ADD CONSTRAINT "billing_payments_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED'));
