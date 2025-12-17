-- Deprecate vehicle_type column and sync from vehicle_categories
-- This migration ensures backward compatibility while standardizing on vehicle_categories

-- Step 1: Ensure all vehicles have a default category if NULL
-- First, get or create a default "Van" category
DO $$
DECLARE
  default_van_category_id UUID;
BEGIN
  -- Get or create "Van" category
  SELECT id INTO default_van_category_id
  FROM vehicle_categories
  WHERE LOWER(name) = 'van'
  LIMIT 1;

  -- If no Van category exists, create it
  IF default_van_category_id IS NULL THEN
    INSERT INTO vehicle_categories (name, description)
    VALUES ('Van', 'Light commercial vehicle')
    RETURNING id INTO default_van_category_id;
  END IF;

  -- Update all vehicles with NULL category_id to use Van as default
  UPDATE vehicles
  SET category_id = default_van_category_id
  WHERE category_id IS NULL;
END $$;

-- Step 2: Create trigger function to auto-sync vehicle_type from vehicle_categories.name
-- This maintains backward compatibility for any legacy code still reading vehicle_type
CREATE OR REPLACE FUNCTION sync_vehicle_type_from_category()
RETURNS TRIGGER AS $$
BEGIN
  -- When category_id changes, update vehicle_type to match
  IF NEW.category_id IS NOT NULL THEN
    NEW.vehicle_type := (
      SELECT name 
      FROM vehicle_categories 
      WHERE id = NEW.category_id
    );
  ELSE
    -- If no category, set to NULL
    NEW.vehicle_type := NULL;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 3: Create trigger on vehicles table
DROP TRIGGER IF EXISTS trigger_sync_vehicle_type ON vehicles;

CREATE TRIGGER trigger_sync_vehicle_type
  BEFORE INSERT OR UPDATE OF category_id
  ON vehicles
  FOR EACH ROW
  EXECUTE FUNCTION sync_vehicle_type_from_category();

-- Step 4: Sync all existing vehicles
UPDATE vehicles v
SET vehicle_type = vc.name
FROM vehicle_categories vc
WHERE v.category_id = vc.id;

-- Step 5: Add constraint to ensure category_id is always set (no more NULL values)
-- This ensures all new vehicles MUST have a category
ALTER TABLE vehicles
ALTER COLUMN category_id SET NOT NULL;

-- Step 6: Add comment to document deprecation
COMMENT ON COLUMN vehicles.vehicle_type IS 
  'DEPRECATED: Auto-synced from vehicle_categories.name for backward compatibility. DO NOT use in new code. Use vehicles.category_id and join vehicle_categories instead.';

COMMENT ON COLUMN vehicles.category_id IS 
  'Primary vehicle categorization. Links to vehicle_categories table. Required field.';
