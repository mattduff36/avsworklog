-- Migration: Fix Double-Wrapped Auth Functions in Profiles RLS
-- Date: 2026-01-22
-- Purpose: Clean up improperly nested SELECT auth.uid() calls
-- Issue: Previous migration created (SELECT (SELECT auth.uid())) instead of (select auth.uid())

BEGIN;

-- Drop existing policies on profiles table
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Authenticated users can view all profiles" ON public.profiles;

-- Recreate with properly optimized auth function calls

-- Policy 1: Authenticated users can view all profiles
-- This policy uses auth.role() which doesn't need optimization (not row-based)
CREATE POLICY "Authenticated users can view all profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (auth.role() = 'authenticated');

-- Policy 2: Users can view own profile
CREATE POLICY "Users can view own profile"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = id);

-- Policy 3: Users can update own profile
-- Admins and managers can update any profile, users can only update their own
CREATE POLICY "Users can update own profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = id)
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM profiles
      WHERE profiles.id = (select auth.uid())
        AND profiles.role = ANY (ARRAY['admin', 'manager'])
    )
  );

COMMIT;

-- Verification
DO $$
DECLARE
  unoptimized_count INTEGER;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '✅ Profiles RLS Policies Fixed!';
  RAISE NOTICE '';
  
  -- Check for any remaining unoptimized patterns
  SELECT COUNT(*) INTO unoptimized_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'profiles'
    AND (
      qual ~ 'auth\.uid\(\)(?!.*select)'
      OR qual ~ 'auth\.jwt\(\)(?!.*select)'
      OR with_check ~ 'auth\.uid\(\)(?!.*select)'
      OR with_check ~ 'auth\.jwt\(\)(?!.*select)'
    );
  
  IF unoptimized_count = 0 THEN
    RAISE NOTICE '✓ All profiles policies properly optimized';
    RAISE NOTICE '✓ Auth functions wrapped in SELECT subqueries';
  ELSE
    RAISE WARNING 'Still have % unoptimized policy patterns', unoptimized_count;
  END IF;
  
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '';
END $$;
