-- Rollback manual untuk migration `20260829234941_add_mfa`.
DROP TABLE IF EXISTS "mfa_recovery_codes" CASCADE;
ALTER TABLE "users"
  DROP COLUMN IF EXISTS "mfa_secret",
  DROP COLUMN IF EXISTS "mfa_enabled_at",
  DROP COLUMN IF EXISTS "mfa_last_counter";
