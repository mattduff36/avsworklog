-- Fix RLS Policies to Prevent Infinite Recursion
-- Run this in Supabase SQL Editor to fix the circular reference issue

-- Drop the problematic policies
DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON profiles;
DROP POLICY IF EXISTS "Managers can view all profiles" ON profiles;

-- Recreate policies using JWT claims instead of querying profiles table
-- This prevents infinite recursion

-- Admin policies (check role from auth.jwt())
CREATE POLICY "Admins can view all profiles" ON profiles
  FOR SELECT USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
    OR 
    auth.uid() = id  -- Users can always see their own profile
  );

CREATE POLICY "Admins can update all profiles" ON profiles
  FOR UPDATE USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
  );

-- Manager policies
CREATE POLICY "Managers can view all profiles" ON profiles
  FOR SELECT USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') IN ('admin', 'manager')
    OR 
    auth.uid() = id  -- Users can always see their own profile
  );

-- Note: We need to ensure user_metadata.role is set when users are created
-- The trigger already does this, but we should also update existing users

-- Update user_metadata for existing test users
DO $$
DECLARE
  user_record RECORD;
BEGIN
  FOR user_record IN 
    SELECT u.id, p.role 
    FROM auth.users u
    JOIN profiles p ON u.id = p.id
  LOOP
    UPDATE auth.users
    SET raw_user_meta_data = jsonb_set(
      COALESCE(raw_user_meta_data, '{}'::jsonb),
      '{role}',
      to_jsonb(user_record.role::text)
    )
    WHERE id = user_record.id;
  END LOOP;
END $$;

SELECT 'RLS policies fixed successfully!' as status;

