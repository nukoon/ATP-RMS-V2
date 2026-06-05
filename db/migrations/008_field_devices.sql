-- 008_field_devices.sql
-- Field devices: peripherals the fleet interacts with at a map node — automatic
-- doors, traffic lights, lifts, conveyors, … Foundation only: the actual
-- "docking signal" handshake (how the AMR/RMS opens a door, reads a light, calls
-- a lift) is intentionally NOT designed yet and will live in `config` (JSON).
-- Apply with the atp_app user.

CREATE TABLE IF NOT EXISTS `field_device` (
  `id`         INT PRIMARY KEY AUTO_INCREMENT,
  `name`       VARCHAR(64) NOT NULL,
  `type`       VARCHAR(16) NOT NULL DEFAULT 'DOOR',   -- DOOR | TRAFFIC_LIGHT | LIFT | CONVEYOR | GENERIC
  `node_id`    VARCHAR(32) NOT NULL,                  -- map node it sits at
  `state`      VARCHAR(16) NULL,                      -- device-dependent (OPEN/CLOSED, RED/GREEN, …)
  `config`     JSON NULL,                             -- reserved: future docking-signal integration
  `map_id`     INT NULL,
  `enabled`    TINYINT DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_device_node (node_id)
);
