-- ============================================================
-- Migration 002 — Storage AREAS (batch pickup/drop grouping) and
-- DOCKS (parking + charging points, optionally bound to a robot).
-- Apply to an EXISTING atp_rms WITHOUT dropping other tables:
--   mysql --defaults-extra-file=<atp_app.cnf> atp_rms < 002_areas_docks.sql
-- NOTE: the storage.area_id ALTER is NOT idempotent — run this migration once.
-- (the storage_area / dock tables are dropped & recreated, so those are safe.)
-- ============================================================
USE atp_rms;
SET NAMES utf8mb4;

-- ── Storage areas: a named group of storages picked/dropped as a batch ──
DROP TABLE IF EXISTS `storage_area`;
CREATE TABLE `storage_area` (
  `id`         INT PRIMARY KEY AUTO_INCREMENT,
  `name`       VARCHAR(64) NOT NULL UNIQUE,
  `kind`       VARCHAR(8) DEFAULT 'BOTH',   -- PICK | DROP | BOTH
  `map_id`     INT NULL,
  `enabled`    TINYINT DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Each storage may belong to at most one area (nullable FK by id, no constraint
-- so an area delete just orphans members — the server nulls them explicitly).
ALTER TABLE `storage`
  ADD COLUMN `area_id` INT NULL AFTER `map_id`;

-- ── Docks: parking & charging points, optionally bound to a robot ──
DROP TABLE IF EXISTS `dock`;
CREATE TABLE `dock` (
  `id`         INT PRIMARY KEY AUTO_INCREMENT,
  `name`       VARCHAR(64) NOT NULL,
  `node_id`    VARCHAR(32) NOT NULL,
  `type`       VARCHAR(8) DEFAULT 'PARK',   -- PARK | CHARGE
  `agv_id`     VARCHAR(64) NULL,            -- bound robot id/serial (runtime id)
  `map_id`     INT NULL,
  `enabled`    TINYINT DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_dock_node (node_id)
);
