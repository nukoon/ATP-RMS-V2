-- 009_map_scoped.sql
-- Scope shared facility data to a specific map so different sites/maps don't
-- overlap. map_id stored the (unused) INT before; switch it to the config map
-- key (VARCHAR, e.g. 'builtin-origin' / 'map-<ts>'). Existing rows were created
-- against the default map → backfill to 'builtin-origin'. Apply with atp_app.

ALTER TABLE `storage`       MODIFY COLUMN `map_id` VARCHAR(64) NULL;
ALTER TABLE `storage_area`  MODIFY COLUMN `map_id` VARCHAR(64) NULL;
ALTER TABLE `dock`          MODIFY COLUMN `map_id` VARCHAR(64) NULL;
ALTER TABLE `traffic_area`  MODIFY COLUMN `map_id` VARCHAR(64) NULL;
ALTER TABLE `field_device`  MODIFY COLUMN `map_id` VARCHAR(64) NULL;

UPDATE `storage`      SET `map_id` = 'builtin-origin' WHERE `map_id` IS NULL OR `map_id` = '';
UPDATE `storage_area` SET `map_id` = 'builtin-origin' WHERE `map_id` IS NULL OR `map_id` = '';
UPDATE `dock`         SET `map_id` = 'builtin-origin' WHERE `map_id` IS NULL OR `map_id` = '';
UPDATE `traffic_area` SET `map_id` = 'builtin-origin' WHERE `map_id` IS NULL OR `map_id` = '';
UPDATE `field_device` SET `map_id` = 'builtin-origin' WHERE `map_id` IS NULL OR `map_id` = '';
