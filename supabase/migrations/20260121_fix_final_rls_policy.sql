-- Migration: Fix Final Unoptimized RLS Policy
-- Date: 2026-01-21
-- Purpose: Optimize the one remaining policy that wasn't caught by the bulk optimization
-- Table: vehicle_categories, Policy: "Admins can manage categories"

BEGIN;

-- Drop existing policy
DROP POLICY IF EXISTS "Admins can manage categories" ON public.vehicle_categories;

-- Recreate with optimized auth function call
CREATE POLICY "Admins can manage categories"
  ON public.vehicle_categories
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM profiles
      WHERE profiles.id = (select auth.uid())
        AND profiles.role = 'admin'::text
    )
  );

COMMIT;

-- Verification
DO $$
BEGIN
  RAISE NOTICE '✅ Final RLS policy optimized!';
  RAISE NOTICE 'Run check-rls-optimization script to verify all policies';
END $$;
