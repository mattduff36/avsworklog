-- =============================================================================
-- Simplify Plant Categories
-- =============================================================================
-- This migration simplifies plant categories to a single "All plant" category
-- and removes all plant-specific categories from vehicle_categories table
-- =============================================================================

-- Step 1: Create the "All plant" category if it doesn't exist
INSERT INTO vehicle_categories (name, description)
VALUES ('All plant', 'All plant machinery and equipment')
ON CONFLICT (name) DO NOTHING;

-- Step 2: Update ALL plant records to use the "All plant" category
DO $$
DECLARE
  all_plant_id UUID;
BEGIN
  -- Get the "All plant" category ID
  SELECT id INTO all_plant_id 
  FROM vehicle_categories 
  WHERE name = 'All plant';

  -- Update ALL plant records to use "All plant" category
  UPDATE plant
  SET category_id = all_plant_id;
END $$;

-- Step 3: Clean up old plant-specific categories if they exist and aren't used by vehicles
-- Only delete categories that are not used by any vehicles
DELETE FROM vehicle_categories
WHERE name IN ('Excavator', 'Telehandler', 'Dumper', 'Access & Site Support', 'Unclassified')
AND id NOT IN (SELECT DISTINCT category_id FROM vehicles WHERE category_id IS NOT NULL);

-- Verification: Check that all plant records now use "All plant" category
-- SELECT vc.name, COUNT(p.id) as plant_count
-- FROM vehicle_categories vc
-- LEFT JOIN plant p ON p.category_id = vc.id
-- WHERE vc.name = 'All plant'
-- GROUP BY vc.id, vc.name;


