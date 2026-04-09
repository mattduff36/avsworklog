BEGIN;

-- Allow multiple inspection rows for the same asset/period as long as they belong
-- to different users. A single user may still only submit one row per asset/period.

-- Plant inspections (owned assets)
DROP INDEX IF EXISTS idx_unique_plant_inspection_date;
DROP INDEX IF EXISTS idx_unique_plant_inspection_date_new;
DROP INDEX IF EXISTS idx_unique_plant_inspection_user_date;

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_plant_inspection_user_date
  ON plant_inspections (plant_id, user_id, inspection_date)
  WHERE plant_id IS NOT NULL;

-- Plant inspections (hired assets)
DROP INDEX IF EXISTS idx_unique_hired_plant_inspection_date;
DROP INDEX IF EXISTS idx_unique_hired_plant_inspection_date_new;
DROP INDEX IF EXISTS idx_unique_hired_plant_inspection_user_date;

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_hired_plant_inspection_user_date
  ON plant_inspections (hired_plant_id_serial, user_id, inspection_date)
  WHERE is_hired_plant = TRUE
    AND hired_plant_id_serial IS NOT NULL;

-- HGV inspections
DROP INDEX IF EXISTS idx_unique_hgv_inspection_date;
DROP INDEX IF EXISTS idx_unique_hgv_inspection_user_date;

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_hgv_inspection_user_date
  ON hgv_inspections (hgv_id, user_id, inspection_date)
  WHERE hgv_id IS NOT NULL;

-- Van inspections remain week-based, but the same van/week can now be inspected
-- by the same user multiple times as long as the day coverage does not overlap.
-- Day overlap is enforced in application logic because weekly rows store their
-- day coverage in inspection_items, not on the parent row itself.
ALTER TABLE van_inspections
  DROP CONSTRAINT IF EXISTS van_inspections_vehicle_week_key;

ALTER TABLE van_inspections
  DROP CONSTRAINT IF EXISTS vehicle_inspections_vehicle_week_key;

DROP INDEX IF EXISTS van_inspections_vehicle_week_key;
DROP INDEX IF EXISTS vehicle_inspections_vehicle_week_key;

COMMIT;
