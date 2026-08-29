-- Rollback manual untuk migration `20260829230003_add_audit_log_indexes`.
DROP INDEX IF EXISTS "idx_audit_metadata_trgm";
DROP INDEX IF EXISTS "idx_audit_action";
DROP INDEX IF EXISTS "idx_audit_created";
-- Ekstensi pg_trgm dibiarkan terpasang (tidak mengganggu).
