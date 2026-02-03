-- =============================================================================
-- Add Registration Number to Plant Table
-- =============================================================================
-- This migration adds a reg_number field to the plant table to support
-- road-legal plant machinery that has vehicle registration numbers
-- =============================================================================

-- Add reg_number column to plant table for road-legal plant machinery (if not exists)
ALTER TABLE plant
ADD COLUMN IF NOT EXISTS reg_number VARCHAR(20) NULL;

-- Add index for reg_number for fast lookups
CREATE INDEX IF NOT EXISTS idx_plant_reg_number ON plant(reg_number) WHERE reg_number IS NOT NULL;

-- Add comment explaining the field
COMMENT ON COLUMN plant.reg_number IS 'Vehicle registration number for road-legal plant machinery (optional)';
