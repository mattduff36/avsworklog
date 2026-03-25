-- =============================================================================
-- Fix Supabase Security Advisor errors (2026-03-25)
-- =============================================================================
-- 1. Drop the legacy vehicle_inspections compatibility view
--    (flagged as Security Definer View — views run as the owner by default,
--     bypassing RLS on underlying tables; code cutover is complete so the
--     view is no longer needed)
-- 2. Enable RLS on absence_bulk_batches
--    (table exists but RLS was not enabled in production)
-- =============================================================================

-- ── 1. Drop the vehicle_inspections compatibility view ──────────────────────
DROP VIEW IF EXISTS vehicle_inspections;

-- ── 2. Enable RLS on absence_bulk_batches ───────────────────────────────────
ALTER TABLE IF EXISTS absence_bulk_batches ENABLE ROW LEVEL SECURITY;

-- Verify the four expected policies still exist
DO $$
DECLARE
  policy_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename  = 'absence_bulk_batches';

  IF policy_count < 4 THEN
    RAISE WARNING 'absence_bulk_batches has only % RLS policies (expected 4)', policy_count;
  END IF;
END $$;
