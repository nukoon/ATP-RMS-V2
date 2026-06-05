-- 006_config_sync.sql
-- Multi-user support:
--   app_config  — server-saved shared settings (broker config), so every
--                 operator sees the same configuration instead of per-browser
--                 localStorage.
--   sync_state  — a single global revision counter bumped on every change to
--                 shared data (storages/areas/docks/traffic/config). Clients
--                 poll it to auto-refresh and detect concurrent edits.
-- Apply with the atp_app user.

CREATE TABLE IF NOT EXISTS `app_config` (
  `k`          VARCHAR(64) PRIMARY KEY,
  `v`          JSON NULL,
  `updated_by` VARCHAR(64) NULL,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS `sync_state` (
  `id`         INT PRIMARY KEY,
  `rev`        BIGINT NOT NULL DEFAULT 0,
  `scope`      VARCHAR(32) NULL,
  `updated_by` VARCHAR(64) NULL,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
INSERT IGNORE INTO `sync_state` (id, rev) VALUES (1, 0);
