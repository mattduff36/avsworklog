-- Migration: Add period_value to maintenance_categories
-- Date: 2026-02-17
-- Purpose: Store the due interval (period) for each maintenance category
--   - Date type: value in months (e.g. 12 = every 12 months)
--   - Mileage type: value in miles (e.g. 10000 = every 10,000 miles)
--   - Hours type: value in hours (e.g. 250 = every 250 hours)

BEGIN;

-- Step 1: Add the column as nullable first so we can backfill
ALTER TABLE maintenance_categories
ADD COLUMN IF NOT EXISTS period_value INTEGER;

-- Step 2: Backfill known categories by name
UPDATE maintenance_categories SET period_value = 12
WHERE LOWER(name) = 'tax due date' AND period_value IS NULL;

UPDATE maintenance_categories SET period_value = 12
WHERE LOWER(name) = 'mot due date' AND period_value IS NULL;

UPDATE maintenance_categories SET period_value = 12
WHERE LOWER(name) = 'loler due' AND period_value IS NULL;

UPDATE maintenance_categories SET period_value = 12
WHERE LOWER(name) = 'first aid kit expiry' AND period_value IS NULL;

UPDATE maintenance_categories SET period_value = 10000
WHERE LOWER(name) = 'service due' AND type = 'mileage' AND period_value IS NULL;

UPDATE maintenance_categories SET period_value = 60000
WHERE LOWER(name) = 'cambelt replacement' AND period_value IS NULL;

UPDATE maintenance_categories SET period_value = 250
WHERE LOWER(name) = 'service due (hours)' AND period_value IS NULL;

-- Step 3: Backfill any remaining rows by type
UPDATE maintenance_categories SET period_value = 12
WHERE type = 'date' AND period_value IS NULL;

UPDATE maintenance_categories SET period_value = 10000
WHERE type = 'mileage' AND period_value IS NULL;

UPDATE maintenance_categories SET period_value = 250
WHERE type = 'hours' AND period_value IS NULL;

-- Step 4: Now enforce NOT NULL and CHECK constraint
ALTER TABLE maintenance_categories
ALTER COLUMN period_value SET NOT NULL;

ALTER TABLE maintenance_categories
ADD CONSTRAINT check_period_value_positive CHECK (period_value > 0);

-- Step 5: Add descriptive comment
COMMENT ON COLUMN maintenance_categories.period_value IS
  'Due interval for the category. Units depend on type: months (date), miles (mileage), hours (hours).';

-- Verification
DO $$
DECLARE
  null_count INTEGER;
  total_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_count FROM maintenance_categories;
  SELECT COUNT(*) INTO null_count FROM maintenance_categories WHERE period_value IS NULL;

  RAISE NOTICE '';
  RAISE NOTICE '✅ period_value migration completed!';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE 'Total categories: %', total_count;
  RAISE NOTICE 'Null period_value: % (should be 0)', null_count;
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
END $$;

COMMIT;
