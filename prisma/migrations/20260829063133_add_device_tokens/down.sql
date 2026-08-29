-- Rollback manual untuk migration `20260829063133_add_device_tokens`.
DROP TABLE IF EXISTS "device_tokens" CASCADE;
