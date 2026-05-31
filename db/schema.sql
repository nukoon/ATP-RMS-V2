-- ============================================================
-- ATP-RMS-V2 — Fleet Management Digital Twin · Database Schema
-- MySQL 8.0 · VDA5050 v2.0 compatible
-- Adapted from the legacy AIPA RDS v2 schema (C:\Aipa\System\Rds\sql),
-- aligned to our TypeScript domain model in src/types/index.ts.
-- ============================================================

CREATE DATABASE IF NOT EXISTS atp_rms
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE atp_rms;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ──────────────────────────────────────────────
-- AGV Types (robot models with physical specs)
-- ──────────────────────────────────────────────
DROP TABLE IF EXISTS `agv_type`;
CREATE TABLE `agv_type` (
  `id`            INT PRIMARY KEY AUTO_INCREMENT,
  `code`          VARCHAR(32)  NOT NULL UNIQUE,      -- AM15, MP10S, ... (matches AgvModel enum)
  `name`          VARCHAR(64)  NOT NULL,
  `category`      VARCHAR(32),                       -- AMR / Lifter / Forklift / Tug
  `load_kg`       INT,                               -- max payload
  `speed_max`     DECIMAL(4,2),                      -- m/s
  `length_mm`     INT,
  `width_mm`      INT,
  `height_mm`     INT,
  `turn_radius`   INT,                               -- mm, 0 = spin in place
  `battery_kwh`   DECIMAL(5,2),
  `image`         VARCHAR(128),                      -- relative to /assets/agv/<code>/
  `created_at`    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Real specs carried over from the legacy fleet (AIPA RDS v2)
INSERT INTO `agv_type` (code, name, category, load_kg, speed_max, length_mm, width_mm, height_mm, turn_radius, battery_kwh, image) VALUES
('AM15',  'AMR 1500kg',       'AMR',      1500, 1.50, 1200, 800,   320, 0,    1.20, 'AM15'),
('MP10S', 'Mouse Pallet 1T',  'AMR',      1000, 1.80, 1000, 600,   280, 0,    0.90, 'MP10S'),
('AL02',  'Auto Lifter 200',  'Lifter',   200,  1.20, 700,  500,  1800, 600,  0.60, 'AL02'),
('APe15', 'Auto Pallet 1.5T', 'Forklift', 1500, 1.60, 2000, 900,  2100, 1200, 2.40, 'APe15'),
('AS15',  'Auto Stacker 1.5T','Forklift', 1500, 1.30, 1900, 1000, 2300, 1400, 2.40, 'AS15'),
('TP30',  'Tow Pallet 3T',    'Tug',      3000, 2.00, 1300, 700,   400, 0,    1.50, 'TP30'),
('TP60',  'Tow Pallet 6T',    'Tug',      6000, 1.80, 1500, 800,   450, 0,    2.00, 'TP60'),
('TT15',  'Tunnel Tug 1.5T',  'Tug',      1500, 2.00, 1100, 600,   300, 0,    1.20, 'TT15'),
('TT30',  'Tunnel Tug 3T',    'Tug',      3000, 1.90, 1300, 700,   350, 0,    1.50, 'TT30'),
('TT60',  'Tunnel Tug 6T',    'Tug',      6000, 1.70, 1600, 850,   500, 0,    2.20, 'TT60');

-- ──────────────────────────────────────────────
-- Maps (per floor) — stores ATP map JSON
-- ──────────────────────────────────────────────
DROP TABLE IF EXISTS `map`;
CREATE TABLE `map` (
  `id`            INT PRIMARY KEY AUTO_INCREMENT,
  `name`          VARCHAR(64) NOT NULL,
  `floor`         INT DEFAULT 1,
  `building_id`   INT,
  `origin_x`      DECIMAL(10,3),
  `origin_y`      DECIMAL(10,3),
  `resolution`    DECIMAL(6,4),                      -- meters per pixel
  `width`         INT,
  `height`        INT,
  `image`         VARCHAR(128),
  `data`          LONGTEXT,                          -- ATP JSON (advancedPointList / advancedCurveList)
  `created_at`    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ──────────────────────────────────────────────
-- Map Points (nodes) — matches NodeClass + Park
-- ──────────────────────────────────────────────
DROP TABLE IF EXISTS `map_point`;
CREATE TABLE `map_point` (
  `id`            INT PRIMARY KEY AUTO_INCREMENT,
  `map_id`        INT NOT NULL,
  `node_id`       VARCHAR(32) NOT NULL,              -- LM1, AP2, CH3
  `name`          VARCHAR(64),
  `type`          VARCHAR(16),                       -- LocationMark / ActionPoint / Charge / Park
  `x`             DECIMAL(10,3),
  `y`             DECIMAL(10,3),
  `theta`         DECIMAL(6,3),                      -- degrees (our canvas convention)
  `floor`         INT DEFAULT 1,
  INDEX idx_map (map_id)
);

-- ──────────────────────────────────────────────
-- AGV instances (real robots) — backs the UI Robot model
-- ──────────────────────────────────────────────
DROP TABLE IF EXISTS `agv`;
CREATE TABLE `agv` (
  `id`            INT PRIMARY KEY AUTO_INCREMENT,
  `sn`            VARCHAR(64) NOT NULL UNIQUE,       -- VDA5050 serialNumber
  `name`          VARCHAR(64),                       -- e.g. AMR-001
  `agv_type_id`   INT NOT NULL,
  `manufacturer`  VARCHAR(32) DEFAULT 'ATP',
  `ip`            VARCHAR(32),
  `status`        VARCHAR(16) DEFAULT 'OFFLINE',     -- IDLE/EXECUTING/CHARGING/ERROR/PAUSE/TRAFFIC/UNAVAILABLE/OFFLINE
  `battery`       DECIMAL(5,2) DEFAULT 0,
  `map_id`        INT,
  `x`             DECIMAL(10,3) DEFAULT 0,
  `y`             DECIMAL(10,3) DEFAULT 0,
  `theta`         DECIMAL(6,3) DEFAULT 0,            -- degrees
  `current_node`  VARCHAR(32),
  `current_floor` INT DEFAULT 1,
  `last_online`   TIMESTAMP NULL,
  `created_at`    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_type (agv_type_id),
  INDEX idx_status (status)
);

-- ──────────────────────────────────────────────
-- Missions (transport / charge / move jobs) — backs FleetOrder
-- ──────────────────────────────────────────────
DROP TABLE IF EXISTS `mission`;
CREATE TABLE `mission` (
  `id`            BIGINT PRIMARY KEY AUTO_INCREMENT,
  `mission_no`    VARCHAR(32) NOT NULL UNIQUE,
  `agv_id`        INT,
  `type`          VARCHAR(16),                       -- TRANSPORT / CHARGE / MOVE
  `status`        VARCHAR(16) DEFAULT 'PENDING',     -- PENDING/ASSIGNED/EXECUTING/FINISHED/FAILED/CANCELLED
  `priority`      INT DEFAULT 5,                     -- 1 = highest .. 9 = lowest
  `start_node`    VARCHAR(32),
  `end_node`      VARCHAR(32),
  `progress`      INT DEFAULT 0,                     -- 0..100
  `payload`       VARCHAR(255),                      -- JSON extra params
  `created_at`    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `assigned_at`   TIMESTAMP NULL,
  `started_at`    TIMESTAMP NULL,
  `finished_at`   TIMESTAMP NULL,
  INDEX idx_agv (agv_id),
  INDEX idx_status (status)
);

-- ──────────────────────────────────────────────
-- Robot status history (telemetry time-series)
-- ──────────────────────────────────────────────
DROP TABLE IF EXISTS `robot_status_record`;
CREATE TABLE `robot_status_record` (
  `id`            BIGINT PRIMARY KEY AUTO_INCREMENT,
  `agv_id`        INT NOT NULL,
  `status`        VARCHAR(16),
  `battery`       DECIMAL(5,2),
  `x`             DECIMAL(10,3),
  `y`             DECIMAL(10,3),
  `theta`         DECIMAL(6,3),
  `mileage`       DECIMAL(12,3),                     -- cumulative meters
  `recorded_at`   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_agv_time (agv_id, recorded_at)
);

-- ──────────────────────────────────────────────
-- Alarms / Events
-- ──────────────────────────────────────────────
DROP TABLE IF EXISTS `alarm`;
CREATE TABLE `alarm` (
  `id`            BIGINT PRIMARY KEY AUTO_INCREMENT,
  `agv_id`        INT,
  `code`          VARCHAR(32),                       -- E001, W101 ...
  `level`         VARCHAR(16),                       -- INFO/WARNING/ERROR/FATAL
  `message`       VARCHAR(255),
  `status`        VARCHAR(16) DEFAULT 'ACTIVE',      -- ACTIVE/RESOLVED
  `created_at`    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `resolved_at`   TIMESTAMP NULL,
  INDEX idx_agv (agv_id),
  INDEX idx_status (status)
);

-- ──────────────────────────────────────────────
-- System users (RBAC)
-- ──────────────────────────────────────────────
DROP TABLE IF EXISTS `sys_user`;
CREATE TABLE `sys_user` (
  `id`            INT PRIMARY KEY AUTO_INCREMENT,
  `username`      VARCHAR(64) NOT NULL UNIQUE,
  `password`      VARCHAR(128) NOT NULL,             -- BCrypt
  `real_name`     VARCHAR(64),
  `role`          VARCHAR(16) DEFAULT 'VIEWER',      -- ADMIN/OPERATOR/VIEWER
  `enabled`       TINYINT DEFAULT 1,
  `last_login`    TIMESTAMP NULL,
  `created_at`    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- default admin / admin123 (BCrypt) — carried over from legacy
INSERT INTO `sys_user` (username, password, real_name, role) VALUES
('admin', '$2a$10$N.zmdr9k7uOCQb376NoUnuTJ8iAt6Z5EHsM8lE9lBOsl7iKTVKIUi', 'Administrator', 'ADMIN');

SET FOREIGN_KEY_CHECKS = 1;
