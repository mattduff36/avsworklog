-- Migration: Fix error_reports foreign key to reference profiles instead of auth.users
-- Date: 2026-01-26
--
-- Problem: error_reports.created_by references auth.users(id), but API queries
-- need to join to profiles table to get full_name. PostgREST can't resolve
-- user:created_by(...) relationship, causing PGRST200 errors.
--
-- Solution: Update FK to reference profiles(id) which matches auth.users(id) via uid.

-- ============================================================================
-- Update error_reports FK constraints
-- ============================================================================

-- Drop existing FK constraints on created_by and resolved_by
ALTER TABLE error_reports DROP CONSTRAINT IF EXISTS error_reports_created_by_fkey;
ALTER TABLE error_reports DROP CONSTRAINT IF EXISTS error_reports_resolved_by_fkey;

-- Add new FK constraints pointing to profiles
ALTER TABLE error_reports 
  ADD CONSTRAINT error_reports_created_by_fkey 
  FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE error_reports 
  ADD CONSTRAINT error_reports_resolved_by_fkey 
  FOREIGN KEY (resolved_by) REFERENCES profiles(id) ON DELETE SET NULL;

-- ============================================================================
-- Update error_report_updates FK constraint
-- ============================================================================

ALTER TABLE error_report_updates DROP CONSTRAINT IF EXISTS error_report_updates_created_by_fkey;

ALTER TABLE error_report_updates 
  ADD CONSTRAINT error_report_updates_created_by_fkey 
  FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE CASCADE;

-- ============================================================================
-- Verification
-- ============================================================================

-- Verify the FK exists
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'error_reports_created_by_fkey'
    AND table_name = 'error_reports'
  ) THEN
    RAISE NOTICE 'FK constraint error_reports_created_by_fkey created successfully';
  END IF;
END $$;

-- ============================================================================
-- End of migration
-- ============================================================================
