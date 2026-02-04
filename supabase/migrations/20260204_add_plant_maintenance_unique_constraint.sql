-- =============================================================================
-- Add UNIQUE constraint to plant_id in vehicle_maintenance
-- =============================================================================
-- This migration adds proper unique constraints to support upsert operations
-- for both vehicle and plant maintenance records
-- =============================================================================

-- Drop the existing unique constraint on vehicle_id only
ALTER TABLE vehicle_maintenance
DROP CONSTRAINT IF EXISTS unique_vehicle_maintenance;

-- Add separate unique constraint on plant_id for plant assets
-- Uses partial index (WHERE clause) to only apply when plant_id is NOT NULL
CREATE UNIQUE INDEX IF NOT EXISTS unique_plant_maintenance 
  ON vehicle_maintenance(plant_id) 
  WHERE plant_id IS NOT NULL;

-- Re-add unique constraint on vehicle_id for vehicles
-- Uses partial index (WHERE clause) to only apply when vehicle_id is NOT NULL
CREATE UNIQUE INDEX IF NOT EXISTS unique_vehicle_maintenance_id
  ON vehicle_maintenance(vehicle_id) 
  WHERE vehicle_id IS NOT NULL;

-- Verify the constraints exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE indexname = 'unique_plant_maintenance'
  ) THEN
    RAISE EXCEPTION 'Failed to create unique index on plant_id';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE indexname = 'unique_vehicle_maintenance_id'
  ) THEN
    RAISE EXCEPTION 'Failed to create unique index on vehicle_id';
  END IF;
END $$;

-- Add comments
COMMENT ON INDEX unique_plant_maintenance IS 
  'Ensures one maintenance record per plant asset. Partial index only applies when plant_id IS NOT NULL.';
COMMENT ON INDEX unique_vehicle_maintenance_id IS 
  'Ensures one maintenance record per vehicle. Partial index only applies when vehicle_id IS NOT NULL.';

