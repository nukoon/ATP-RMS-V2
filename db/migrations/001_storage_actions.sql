-- ============================================================
-- Migration 001 — Storage areas, VDA5050 action templates, bindings,
-- and mission storage columns. Apply to an EXISTING atp_rms without
-- dropping the other tables (unlike a full schema.sql rerun).
--   mysql --defaults-extra-file=<atp_app.cnf> atp_rms < 001_storage_actions.sql
-- ============================================================
USE atp_rms;
SET NAMES utf8mb4;

DROP TABLE IF EXISTS `storage`;
CREATE TABLE `storage` (
  `id`            INT PRIMARY KEY AUTO_INCREMENT,
  `name`          VARCHAR(64) NOT NULL UNIQUE,
  `node_id`       VARCHAR(32) NOT NULL,
  `map_id`        INT NULL,
  `kind`          VARCHAR(8) DEFAULT 'BOTH',
  `state`         VARCHAR(8) DEFAULT 'EMPTY',
  `label`         VARCHAR(64),
  `enabled`       TINYINT DEFAULT 1,
  `created_at`    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_node (node_id)
);

DROP TABLE IF EXISTS `vda_action`;
CREATE TABLE `vda_action` (
  `id`            INT PRIMARY KEY AUTO_INCREMENT,
  `code`          VARCHAR(32) NOT NULL UNIQUE,
  `action_type`   VARCHAR(48) NOT NULL,
  `name`          VARCHAR(64),
  `blocking_type` VARCHAR(8) DEFAULT 'HARD',
  `description`   VARCHAR(255),
  `default_params` JSON NULL,
  `created_at`    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO `vda_action` (code, action_type, name, blocking_type, description, default_params) VALUES
('liftUp',     'liftUp',     'Lift Up',     'HARD', 'Raise the lift/fork to carry load',  JSON_ARRAY()),
('liftDown',   'liftDown',   'Lift Down',   'HARD', 'Lower the lift/fork to release load', JSON_ARRAY()),
('trayRotate', 'trayRotate', 'Tray Rotate', 'HARD', 'Rotate the tray',                    JSON_ARRAY(JSON_OBJECT('key','angle','value',90))),
('pick',       'pick',       'Pick',        'HARD', 'Pick load at station',               JSON_ARRAY()),
('drop',       'drop',       'Drop',        'HARD', 'Drop load at station',               JSON_ARRAY()),
('wait',       'wait',       'Wait',        'NONE', 'Dwell for a duration',               JSON_ARRAY(JSON_OBJECT('key','duration','value',3)));

DROP TABLE IF EXISTS `storage_action`;
CREATE TABLE `storage_action` (
  `id`            INT PRIMARY KEY AUTO_INCREMENT,
  `storage_id`    INT NOT NULL,
  `vda_action_id` INT NOT NULL,
  `stage`         VARCHAR(8) NOT NULL,
  `seq`           INT DEFAULT 0,
  `params`        JSON NULL,
  INDEX idx_storage (storage_id)
);

ALTER TABLE `mission`
  ADD COLUMN `pickup_storage_id`  INT NULL AFTER `payload`,
  ADD COLUMN `dropoff_storage_id` INT NULL AFTER `pickup_storage_id`,
  ADD COLUMN `actions`            JSON NULL AFTER `dropoff_storage_id`;

-- runtime stores the robot id/serial (string), not an agv.id FK
ALTER TABLE `mission` MODIFY `agv_id` VARCHAR(64) NULL;
