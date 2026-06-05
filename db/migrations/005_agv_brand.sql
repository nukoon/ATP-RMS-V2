-- 005_agv_brand.sql
-- Per-AMR robot vendor brand → drives its VDA5050 topic scheme + manufacturer
-- (aiten/seer = robot/v2/SEER, generic = uagv/v2). Apply with the atp_app user.
-- Idempotent: skips the column if it already exists.

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'agv' AND COLUMN_NAME = 'brand'
);
SET @sql := IF(@col = 0,
  "ALTER TABLE `agv` ADD COLUMN `brand` VARCHAR(16) NOT NULL DEFAULT 'aiten' AFTER `color`",
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
