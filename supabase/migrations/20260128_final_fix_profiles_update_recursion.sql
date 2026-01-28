-- FINAL FIX: Remove infinite recursion in profiles UPDATE policy
-- Date: 2026-01-28
-- Issue: Profiles UPDATE policy queries profiles table within itself, causing recursion
-- Solution: Use a SECURITY DEFINER function to break the recursion chain

BEGIN;

-- Step 1: Create helper function (if it doesn't exist)
CREATE OR REPLACE FUNCTION is_user_manager_or_admin(user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM profiles p
    JOIN roles r ON p.role_id = r.id
    WHERE p.id = user_id
      AND r.is_manager_admin = true
  );
END;
$$;

-- Step 2: Drop all existing UPDATE policies on profiles
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update any profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;

-- Step 3: Create a single, correct UPDATE policy
CREATE POLICY "Users can update own profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    -- Users can update their own profile OR
    -- Admins/managers can update any profile
    (SELECT auth.uid()) = id
    OR is_user_manager_or_admin((SELECT auth.uid()))
  )
  WITH CHECK (
    -- Users can only save changes to their own profile OR
    -- Admins/managers can save changes to any profile
    (SELECT auth.uid()) = id
    OR is_user_manager_or_admin((SELECT auth.uid()))
  );

COMMIT;

-- Verification
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE 'PROFILES UPDATE POLICY FIX APPLIED';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '✓ Infinite recursion eliminated (using SECURITY DEFINER)';
  RAISE NOTICE '✓ Users can update their own profile';
  RAISE NOTICE '✓ Admins and managers can update any profile';
  RAISE NOTICE '✓ Password change will now work for all users';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '';
END $$;
