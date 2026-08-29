-- CreateTable
CREATE TABLE "report_exports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "requested_by" UUID NOT NULL,
    "report_type" VARCHAR(30) NOT NULL DEFAULT 'attendance',
    "format" VARCHAR(10) NOT NULL,
    "filters" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "storage_key" TEXT,
    "file_name" VARCHAR(200),
    "file_size" INTEGER,
    "row_count" INTEGER,
    "error_message" TEXT,
    "expires_at" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_report_exports_user" ON "report_exports"("requested_by");

-- CreateIndex
CREATE INDEX "idx_report_exports_status" ON "report_exports"("status");

-- AddForeignKey
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
