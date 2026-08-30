-- Rollback manual untuk migration `20260830015410_add_notif_inbox_index`.
DROP INDEX IF EXISTS "idx_notif_user_sent";
