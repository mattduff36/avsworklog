-- =============================================================================
-- Add applies_to column to vehicle_categories
-- =============================================================================
-- This migration adds an applies_to array column to track whether a category
-- applies to vehicles, plant, or both. This enables proper filtering in UI.
-- =============================================================================

-- Step 1: Add applies_to column (defaults to vehicle for backward compatibility)
ALTER TABLE vehicle_categories
ADD COLUMN IF NOT EXISTS applies_to TEXT[] NOT NULL DEFAULT '{vehicle}';

-- Step 2: Backfill applies_to based on actual usage
-- Categories used by vehicles get 'vehicle', by plant get 'plant', by both get both
DO $$
DECLARE
  category_record RECORD;
  used_by_vehicles BOOLEAN;
  used_by_plant BOOLEAN;
  new_applies_to TEXT[];
BEGIN
  FOR category_record IN SELECT id FROM vehicle_categories LOOP
    -- Check if used by vehicles
    SELECT EXISTS (
      SELECT 1 FROM vehicles WHERE category_id = category_record.id
    ) INTO used_by_vehicles;
    
    -- Check if used by plant
    SELECT EXISTS (
      SELECT 1 FROM plant WHERE category_id = category_record.id
    ) INTO used_by_plant;
    
    -- Build applies_to array
    new_applies_to := ARRAY[]::TEXT[];
    IF used_by_vehicles THEN
      new_applies_to := array_append(new_applies_to, 'vehicle');
    END IF;
    IF used_by_plant THEN
      new_applies_to := array_append(new_applies_to, 'plant');
    END IF;
    
    -- If not used by either, keep default (vehicle)
    IF array_length(new_applies_to, 1) IS NULL THEN
      new_applies_to := '{vehicle}';
    END IF;
    
    -- Update the category
    UPDATE vehicle_categories
    SET applies_to = new_applies_to
    WHERE id = category_record.id;
  END LOOP;
END $$;

-- Step 3: Add index for faster filtering
CREATE INDEX IF NOT EXISTS idx_vehicle_categories_applies_to 
  ON vehicle_categories USING GIN (applies_to);

-- Step 4: Add comment
COMMENT ON COLUMN vehicle_categories.applies_to IS 
  'Array indicating whether this category applies to vehicles, plant, or both. Valid values: vehicle, plant';

-- Verification query (commented out)
-- SELECT name, applies_to, 
--   (SELECT COUNT(*) FROM vehicles WHERE category_id = vehicle_categories.id) as vehicle_count,
--   (SELECT COUNT(*) FROM plant WHERE category_id = vehicle_categories.id) as plant_count
-- FROM vehicle_categories
-- ORDER BY name;
