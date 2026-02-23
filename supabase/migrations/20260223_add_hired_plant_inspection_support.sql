-- =============================================================================
-- Hired Plant Inspection Support
-- =============================================================================
-- Adds columns and constraints to allow plant inspections for hired-in
-- machinery that does not exist in the owned plant assets table.
--
-- Changes:
--   1. Add hired-plant columns to vehicle_inspections
--   2. Replace check_inspections_asset constraint (3-way)
--   3. Add unique index for hired plant duplicate prevention
-- =============================================================================

-- Step 1: Add hired-plant columns
ALTER TABLE vehicle_inspections
ADD COLUMN IF NOT EXISTS is_hired_plant BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE vehicle_inspections
ADD COLUMN IF NOT EXISTS hired_plant_id_serial TEXT NULL;

ALTER TABLE vehicle_inspections
ADD COLUMN IF NOT EXISTS hired_plant_description TEXT NULL;

ALTER TABLE vehicle_inspections
ADD COLUMN IF NOT EXISTS hired_plant_hiring_company TEXT NULL;

-- Step 2: Replace the check_inspections_asset constraint with a 3-way version.
-- Drop old constraint first (safe if already dropped).
DO $$
BEGIN
  ALTER TABLE vehicle_inspections DROP CONSTRAINT IF EXISTS check_inspections_asset;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'check_inspections_asset did not exist, skipping drop';
END $$;

ALTER TABLE vehicle_inspections
ADD CONSTRAINT check_inspections_asset CHECK (
  -- Vehicle inspection
  (vehicle_id IS NOT NULL AND plant_id IS NULL AND is_hired_plant = FALSE)
  OR
  -- Owned plant inspection
  (vehicle_id IS NULL AND plant_id IS NOT NULL AND is_hired_plant = FALSE)
  OR
  -- Hired plant inspection: no FK, but all hired fields required
  (
    vehicle_id IS NULL
    AND plant_id IS NULL
    AND is_hired_plant = TRUE
    AND hired_plant_id_serial IS NOT NULL AND length(trim(hired_plant_id_serial)) > 0
    AND hired_plant_description IS NOT NULL AND length(trim(hired_plant_description)) > 0
    AND hired_plant_hiring_company IS NOT NULL AND length(trim(hired_plant_hiring_company)) > 0
  )
);

-- Step 3: Unique index to prevent duplicate hired-plant inspections on the same date
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_hired_plant_inspection_date
ON vehicle_inspections (inspection_date, hired_plant_id_serial)
WHERE is_hired_plant = TRUE;

-- Step 4: Index for querying hired plant inspections efficiently
CREATE INDEX IF NOT EXISTS idx_vehicle_inspections_is_hired_plant
ON vehicle_inspections (is_hired_plant)
WHERE is_hired_plant = TRUE;
