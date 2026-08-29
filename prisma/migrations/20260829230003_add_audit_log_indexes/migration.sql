-- CreateIndex
CREATE INDEX "idx_audit_created" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "idx_audit_action" ON "audit_logs"("action");

-- Free-text search di kolom metadata (JSONB): GIN trigram atas representasi teks.
-- Prisma tidak bisa mengekspresikan index ekspresi / ekstensi -> ditulis manual.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "idx_audit_metadata_trgm" ON "audit_logs" USING gin ((metadata::text) gin_trgm_ops);
