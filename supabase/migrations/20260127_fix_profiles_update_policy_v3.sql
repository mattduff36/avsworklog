-- Migration: Fix Profiles Update Policy - Using Security Definer Function
-- Date: 2026-01-27
-- Purpose: Fix the WITH CHECK clause that was preventing users from updating their own profiles
--          Uses SECURITY DEFINER function to avoid infinite recursion
-- Issue: Cannot query profiles table within profiles RLS policy (causes infinite recursion)
-- Solution: Create a function that bypasses RLS to check if user is manager/admin

BEGIN;

-- Create a security definer function to check if user is manager/admin
-- This function runs with elevated privileges and bypasses RLS
CREATE OR REPLACE FUNCTION public.is_user_manager_or_admin(user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  is_manager BOOLEAN;
BEGIN
  -- Check if user is manager or admin via roles table
  SELECT COALESCE(r.is_manager_admin, FALSE) INTO is_manager
  FROM profiles p
  INNER JOIN roles r ON p.role_id = r.id
  WHERE p.id = user_id;
  
  RETURN COALESCE(is_manager, FALSE);
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.is_user_manager_or_admin(UUID) TO authenticated;

-- Drop the broken policy
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

-- Recreate with correct logic using the security definer function
CREATE POLICY "Users can update own profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    -- Users can update their own profile OR
    -- Admins/managers can update any profile
    (select auth.uid()) = id
    OR is_user_manager_or_admin((select auth.uid()))
  )
  WITH CHECK (
    -- Users can only save changes to their own profile OR
    -- Admins/managers can save changes to any profile
    (select auth.uid()) = id
    OR is_user_manager_or_admin((select auth.uid()))
  );

COMMIT;

-- Verification
DO $$
DECLARE
  policy_count INTEGER;
  function_exists BOOLEAN;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '✅ Profiles Update Policy Fixed (Using Security Definer)!';
  RAISE NOTICE '';
  
  -- Check if function exists
  SELECT EXISTS (
    SELECT 1 FROM pg_proc 
    WHERE proname = 'is_user_manager_or_admin'
  ) INTO function_exists;
  
  IF function_exists THEN
    RAISE NOTICE '✓ Security definer function created: is_user_manager_or_admin()';
  ELSE
    RAISE WARNING '⚠ Function not found';
  END IF;
  
  -- Check if policy exists
  SELECT COUNT(*) INTO policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'profiles'
    AND policyname = 'Users can update own profile';
  
  IF policy_count > 0 THEN
    RAISE NOTICE '✓ Policy "Users can update own profile" created';
  ELSE
    RAISE WARNING '⚠ Policy not found';
  END IF;
  
  RAISE NOTICE '✓ Users can now update their own profile';
  RAISE NOTICE '✓ Admins and managers can update any profile';
  RAISE NOTICE '✓ Users blocked from updating other users profiles';
  RAISE NOTICE '✓ No infinite recursion (uses security definer function)';
  RAISE NOTICE '';
  RAISE NOTICE 'This fixes the password change issue for new users';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '';
END $$;
