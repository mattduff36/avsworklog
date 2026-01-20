-- Migration: Add inspector_comments column to vehicle_inspections
-- Date: 2026-01-20
-- Purpose: Store end-of-inspection notes from inspectors

-- Add inspector_comments column (nullable)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'vehicle_inspections'
      AND column_name = 'inspector_comments'
  ) THEN
    ALTER TABLE vehicle_inspections
      ADD COLUMN inspector_comments TEXT NULL;
    
    RAISE NOTICE 'Added inspector_comments column to vehicle_inspections';
  ELSE
    RAISE NOTICE 'inspector_comments column already exists';
  END IF;
END $$;

-- Add comment for documentation
COMMENT ON COLUMN vehicle_inspections.inspector_comments IS 
  'Optional end-of-inspection notes from the inspector. Can trigger workshop task creation via "Inform workshop" option.';
