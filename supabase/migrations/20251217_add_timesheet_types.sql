-- Migration: Add timesheet type support
-- Description: Enable multiple timesheet types based on role
-- Date: 2025-12-17
-- Author: Lyra AI (approved by Matt)

-- This migration adds the ability to support multiple timesheet types (Civils, Plant, etc.)
-- based on job roles. All existing records default to 'civils' for backward compatibility.

BEGIN;

-- ============================================================================
-- STEP 1: Add timesheet_type column to roles table
-- ============================================================================
-- This allows each role to specify which timesheet format employees should use

ALTER TABLE roles 
ADD COLUMN IF NOT EXISTS timesheet_type TEXT DEFAULT 'civils' 
CHECK (timesheet_type IN ('civils', 'plant'));

COMMENT ON COLUMN roles.timesheet_type IS 'Specifies which timesheet format this role uses (civils, plant, etc.)';

-- ============================================================================
-- STEP 2: Add timesheet_type column to timesheets table
-- ============================================================================
-- This tracks which type each timesheet is, for proper rendering and validation

ALTER TABLE timesheets
ADD COLUMN IF NOT EXISTS timesheet_type TEXT DEFAULT 'civils'
CHECK (timesheet_type IN ('civils', 'plant'));

COMMENT ON COLUMN timesheets.timesheet_type IS 'The type of timesheet (civils, plant, etc.) - determines format and validation';

-- ============================================================================
-- STEP 3: Update existing records (redundant due to DEFAULT, but explicit)
-- ============================================================================
-- Ensure all existing roles and timesheets have the 'civils' type

UPDATE roles 
SET timesheet_type = 'civils' 
WHERE timesheet_type IS NULL;

UPDATE timesheets 
SET timesheet_type = 'civils' 
WHERE timesheet_type IS NULL;

-- ============================================================================
-- STEP 4: Create indexes for performance
-- ============================================================================
-- These indexes speed up queries filtering by timesheet type

CREATE INDEX IF NOT EXISTS idx_roles_timesheet_type 
ON roles(timesheet_type);

CREATE INDEX IF NOT EXISTS idx_timesheets_timesheet_type 
ON timesheets(timesheet_type);

-- ============================================================================
-- STEP 5: Verify the migration
-- ============================================================================
-- Quick sanity checks

DO $$
DECLARE
    role_count INTEGER;
    timesheet_count INTEGER;
BEGIN
    -- Count roles with timesheet_type
    SELECT COUNT(*) INTO role_count FROM roles WHERE timesheet_type IS NOT NULL;
    RAISE NOTICE 'Roles with timesheet_type: %', role_count;
    
    -- Count timesheets with timesheet_type
    SELECT COUNT(*) INTO timesheet_count FROM timesheets WHERE timesheet_type IS NOT NULL;
    RAISE NOTICE 'Timesheets with timesheet_type: %', timesheet_count;
    
    -- Log success
    RAISE NOTICE '✅ Migration completed successfully!';
    RAISE NOTICE '   - All roles default to "civils" timesheet';
    RAISE NOTICE '   - All existing timesheets marked as "civils"';
    RAISE NOTICE '   - Ready to add "plant" type when needed';
END $$;

COMMIT;

-- ============================================================================
-- ROLLBACK INSTRUCTIONS (if needed)
-- ============================================================================
-- If you need to undo this migration, run:
--
-- BEGIN;
-- ALTER TABLE roles DROP COLUMN IF EXISTS timesheet_type;
-- ALTER TABLE timesheets DROP COLUMN IF EXISTS timesheet_type;
-- DROP INDEX IF EXISTS idx_roles_timesheet_type;
-- DROP INDEX IF EXISTS idx_timesheets_timesheet_type;
-- COMMIT;
--
-- Note: This will not affect any existing data, just remove the new columns.
