-- Migration: Add tracker_id and remove cambelt_done field
-- Description: Add GPS tracker ID field for vehicles and remove unused cambelt_done boolean
-- Date: 2025-12-18
-- Author: Lyra AI (approved by Matt)

BEGIN;

-- ============================================================================
-- Add tracker_id column to vehicle_maintenance table
-- ============================================================================

ALTER TABLE vehicle_maintenance
  ADD COLUMN IF NOT EXISTS tracker_id VARCHAR(50);

-- Add index for tracker_id lookups
CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_tracker_id 
  ON vehicle_maintenance(tracker_id) WHERE tracker_id IS NOT NULL;

-- Add comment
COMMENT ON COLUMN vehicle_maintenance.tracker_id IS 'GPS tracker device ID (e.g., 359632101982533)';

-- ============================================================================
-- Remove cambelt_done column (replaced by cambelt_due_mileage)
-- ============================================================================

ALTER TABLE vehicle_maintenance
  DROP COLUMN IF EXISTS cambelt_done;

COMMIT;
