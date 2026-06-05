-- 007_agv_ops.sql
-- Per-AMR operational config: battery thresholds + park/charge map nodes.
-- NULL = use the fleet defaults. Apply with the atp_app user. Idempotent.

SET @sql := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `agv`
     ADD COLUMN `low_battery`    TINYINT NULL AFTER `brand`,
     ADD COLUMN `resume_battery` TINYINT NULL AFTER `low_battery`,
     ADD COLUMN `charge_target`  TINYINT NULL AFTER `resume_battery`,
     ADD COLUMN `park_node`      VARCHAR(32) NULL AFTER `charge_target`,
     ADD COLUMN `charge_node`    VARCHAR(32) NULL AFTER `park_node`',
  'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'agv' AND COLUMN_NAME = 'low_battery');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
