-- Migration: Fix Profiles Update Policy to Allow Users to Update Their Own Profile
-- Date: 2026-01-27
-- Purpose: Fix the WITH CHECK clause that was preventing users from updating their own profiles
-- Issue: The "Users can update own profile" policy had a WITH CHECK that only allowed admins/managers,
--        preventing regular users from updating fields like must_change_password on their own profile

BEGIN;

-- Drop the broken policy
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

-- Recreate with correct logic:
-- - Users can update their own profile (USING clause)
-- - Users can only update their own record (WITH CHECK matches their ID)
-- - Admins and managers can update any profile
CREATE POLICY "Users can update own profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    -- Users can update their own profile OR
    -- Admins/managers can update any profile
    (select auth.uid()) = id
    OR EXISTS (
      SELECT 1
      FROM profiles
      WHERE profiles.id = (select auth.uid())
        AND profiles.role = ANY (ARRAY['admin', 'manager'])
    )
  )
  WITH CHECK (
    -- Users can only save changes to their own profile OR
    -- Admins/managers can save changes to any profile
    (select auth.uid()) = id
    OR EXISTS (
      SELECT 1
      FROM profiles
      WHERE profiles.id = (select auth.uid())
        AND profiles.role = ANY (ARRAY['admin', 'manager'])
    )
  );

COMMIT;

-- Verification
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '✅ Profiles Update Policy Fixed!';
  RAISE NOTICE '';
  RAISE NOTICE '✓ Users can now update their own profile';
  RAISE NOTICE '✓ Admins and managers can update any profile';
  RAISE NOTICE '✓ Users blocked from updating other users profiles';
  RAISE NOTICE '';
  RAISE NOTICE 'This fixes the password change issue for new users';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '';
END $$;
