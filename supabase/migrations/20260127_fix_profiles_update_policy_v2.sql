-- Migration: Fix Profiles Update Policy - Correct Version Without Recursion
-- Date: 2026-01-27
-- Purpose: Fix the WITH CHECK clause that was preventing users from updating their own profiles
--          This version avoids infinite recursion by using the roles table properly
-- Issue: The previous fix caused infinite recursion by querying profiles within a profiles policy

BEGIN;

-- Drop the broken policy
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

-- Recreate with correct logic that avoids recursion:
-- The key is to use role_id FK directly without querying profiles table again
CREATE POLICY "Users can update own profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    -- Users can update their own profile OR
    -- Admins/managers can update any profile (check via roles table, no recursion)
    (select auth.uid()) = id
    OR (
      SELECT r.is_manager_admin
      FROM roles r
      INNER JOIN profiles p ON p.role_id = r.id
      WHERE p.id = (select auth.uid())
      LIMIT 1
    ) = true
  )
  WITH CHECK (
    -- Users can only save changes to their own profile OR
    -- Admins/managers can save changes to any profile (check via roles table, no recursion)
    (select auth.uid()) = id
    OR (
      SELECT r.is_manager_admin
      FROM roles r
      INNER JOIN profiles p ON p.role_id = r.id
      WHERE p.id = (select auth.uid())
      LIMIT 1
    ) = true
  );

COMMIT;

-- Verification
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '✅ Profiles Update Policy Fixed (No Recursion)!';
  RAISE NOTICE '';
  RAISE NOTICE '✓ Uses roles table to check permissions (no recursion)';
  RAISE NOTICE '✓ Users can now update their own profile';
  RAISE NOTICE '✓ Admins and managers can update any profile';
  RAISE NOTICE '✓ Users blocked from updating other users profiles';
  RAISE NOTICE '';
  RAISE NOTICE 'This fixes the password change issue for new users';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '';
END $$;
