-- =============================================================================
-- Plant Serial Number Constraints Migration
-- =============================================================================
-- This migration enforces uniqueness and format constraints on plant.serial_number
-- 
-- Changes:
-- 1. Normalize existing serial_number values (UPPERCASE + strip whitespace)
-- 2. Set empty strings to NULL
-- 3. Set invalid values (non-alphanumeric after normalization) to NULL
-- 4. De-duplicate: keep most recently updated row per serial, NULL others
-- 5. Widen column from VARCHAR(100) to TEXT (no max length)
-- 6. Add CHECK constraint for alphanumeric uppercase pattern
-- 7. Add partial UNIQUE index (only for non-NULL values)
-- =============================================================================

-- =============================================================================
-- Part 1: Normalize Existing Data
-- =============================================================================

-- Step 1: Normalize to uppercase and remove whitespace
UPDATE plant
SET serial_number = UPPER(TRIM(REGEXP_REPLACE(serial_number, '\s+', '', 'g')))
WHERE serial_number IS NOT NULL 
  AND serial_number != '';

-- Step 2: Convert empty strings to NULL
UPDATE plant
SET serial_number = NULL
WHERE serial_number = '';

-- Step 3: Set invalid values to NULL (after normalization, must be alphanumeric only)
-- Pattern: ^[A-Z0-9]+$ (only uppercase letters and numbers)
UPDATE plant
SET serial_number = NULL
WHERE serial_number IS NOT NULL
  AND serial_number !~ '^[A-Z0-9]+$';

-- =============================================================================
-- Part 2: De-duplicate Serial Numbers
-- =============================================================================

-- For duplicate serial numbers, keep the most recently updated row and NULL the others
-- This uses a CTE to identify duplicates and preserve the newest one
WITH duplicate_serials AS (
  SELECT 
    id,
    serial_number,
    ROW_NUMBER() OVER (
      PARTITION BY serial_number 
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
    ) as rn
  FROM plant
  WHERE serial_number IS NOT NULL
)
UPDATE plant
SET serial_number = NULL
FROM duplicate_serials
WHERE plant.id = duplicate_serials.id
  AND duplicate_serials.rn > 1;

-- =============================================================================
-- Part 3: Alter Column Type
-- =============================================================================

-- Widen column from VARCHAR(100) to TEXT (no max length constraint)
ALTER TABLE plant 
ALTER COLUMN serial_number TYPE TEXT;

-- =============================================================================
-- Part 4: Add Constraints
-- =============================================================================

-- Add CHECK constraint: serial_number must be alphanumeric uppercase when not NULL
ALTER TABLE plant
ADD CONSTRAINT check_plant_serial_number_format 
CHECK (
  serial_number IS NULL 
  OR (serial_number ~ '^[A-Z0-9]+$' AND LENGTH(serial_number) > 0)
);

-- Add partial UNIQUE index (only enforces uniqueness for non-NULL values)
-- Drop existing index if it exists (from original migration)
DROP INDEX IF EXISTS idx_plant_serial_number;

-- Create partial unique index
CREATE UNIQUE INDEX idx_plant_serial_number_unique 
ON plant(serial_number) 
WHERE serial_number IS NOT NULL;

-- =============================================================================
-- Comments
-- =============================================================================

COMMENT ON COLUMN plant.serial_number IS 'Manufacturer serial number (alphanumeric uppercase, no spaces, unique when provided)';

-- =============================================================================
-- Verification Query (for migration script to run)
-- =============================================================================

-- Query to verify constraints are in place:
-- SELECT 
--   conname as constraint_name,
--   contype as constraint_type
-- FROM pg_constraint
-- WHERE conrelid = 'plant'::regclass
--   AND conname LIKE '%serial%';

-- Query to verify index:
-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE tablename = 'plant'
--   AND indexname LIKE '%serial%';
