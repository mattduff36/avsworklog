-- ============================================================================
-- Migration: Add Plant Support to Maintenance History
-- ============================================================================
-- Date: 2026-02-04
-- Description: Modifies maintenance_history table to support both vehicles and plant
--              by making vehicle_id nullable and adding plant_id column.
-- 
-- Changes:
-- 1. Make vehicle_id nullable in maintenance_history
-- 2. Add plant_id column with foreign key to plant table
-- 3. Add check constraint to ensure either vehicle_id or plant_id is present
-- 4. Add index for plant_id lookups
-- ============================================================================

-- Make vehicle_id nullable to support plant records
ALTER TABLE maintenance_history
ALTER COLUMN vehicle_id DROP NOT NULL;

-- Add plant_id column
ALTER TABLE maintenance_history
ADD COLUMN plant_id UUID REFERENCES plant(id) ON DELETE CASCADE;

-- Add check constraint: must have either vehicle_id or plant_id (but not both)
ALTER TABLE maintenance_history
ADD CONSTRAINT check_maintenance_history_asset CHECK (
  (vehicle_id IS NOT NULL AND plant_id IS NULL) OR
  (vehicle_id IS NULL AND plant_id IS NOT NULL)
);

-- Add index for plant_id lookups
CREATE INDEX IF NOT EXISTS idx_maintenance_history_plant_id 
  ON maintenance_history(plant_id) 
  WHERE plant_id IS NOT NULL;

-- Add comments for documentation
COMMENT ON COLUMN maintenance_history.vehicle_id IS 
  'Vehicle ID (nullable). Either vehicle_id or plant_id must be present, but not both.';

COMMENT ON COLUMN maintenance_history.plant_id IS 
  'Plant ID (nullable). Either vehicle_id or plant_id must be present, but not both.';

COMMENT ON CONSTRAINT check_maintenance_history_asset ON maintenance_history IS 
  'Ensures maintenance history belongs to either a vehicle or plant asset, but not both.';
