-- ============================================================
-- Migration 003 — TRAFFIC AREAS: operator-defined mutual-exclusion zones.
-- A group of map nodes that at most `capacity` AMRs may occupy at once
-- (default 1 = single-lane lock). The fleet traffic manager makes a robot
-- WAIT outside the zone until it can enter — no reversing.
--   mysql --defaults-extra-file=<atp_app.cnf> atp_rms < 003_traffic_areas.sql
-- (table is dropped & recreated, so this migration is re-runnable.)
-- ============================================================
USE atp_rms;
SET NAMES utf8mb4;

DROP TABLE IF EXISTS `traffic_area`;
CREATE TABLE `traffic_area` (
  `id`         INT PRIMARY KEY AUTO_INCREMENT,
  `name`       VARCHAR(64) NOT NULL UNIQUE,
  `node_ids`   JSON NOT NULL,               -- array of node id strings in the zone
  `capacity`   INT DEFAULT 1,               -- max AMRs allowed inside at once
  `map_id`     INT NULL,
  `enabled`    TINYINT DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
