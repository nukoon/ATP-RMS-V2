-- 004_mission_created_by.sql
-- Command history: record WHO issued each mission (the operator's display name).
-- `created_at` already records WHEN. sys_user (with role) already exists in the
-- base schema, so user management needs no new table — only its CRUD endpoints.
-- Apply with the atp_app user. Idempotent: skips the column if it already exists.

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mission' AND COLUMN_NAME = 'created_by'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE `mission` ADD COLUMN `created_by` VARCHAR(64) NULL AFTER `actions`',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
