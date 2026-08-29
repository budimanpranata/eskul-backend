-- Rollback manual untuk migration `20260829123518_add_report_exports`.
DROP TABLE IF EXISTS "report_exports" CASCADE;
