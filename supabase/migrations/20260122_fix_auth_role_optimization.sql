-- Migration: Fix auth.role() Optimization in Profiles RLS
-- Date: 2026-01-22
-- Purpose: Wrap auth.role() in SELECT to satisfy Supabase linter
-- Issue: Linter reports "Authenticated users can view all profiles" re-evaluates auth functions

BEGIN;

-- Drop and recreate the policy with wrapped auth.role()
DROP POLICY IF EXISTS "Authenticated users can view all profiles" ON public.profiles;

CREATE POLICY "Authenticated users can view all profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING ((select auth.role()) = 'authenticated');

COMMIT;

-- Verification
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '✅ auth.role() Optimization Applied!';
  RAISE NOTICE '';
  RAISE NOTICE '✓ Policy: "Authenticated users can view all profiles"';
  RAISE NOTICE '✓ Changed: auth.role() → (select auth.role())';
  RAISE NOTICE '';
  RAISE NOTICE 'This should clear the Supabase linter warning for';
  RAISE NOTICE 'auth_rls_initplan on the profiles table.';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '';
END $$;
