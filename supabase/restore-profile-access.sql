-- Restore proper profile access without recursion
--
-- The recursion was caused by:
-- 1. Profiles table RLS querying profiles table (infinite loop)
-- 2. Joining profiles -> roles where roles table has RLS
--
-- Solution:
-- 1. Disable RLS on roles table (everyone can read roles)
-- 2. Allow users to view all profiles (needed for app functionality)

-- Step 1: Disable RLS on roles table
-- Roles are public data, no need for row-level security
ALTER TABLE roles DISABLE ROW LEVEL SECURITY;

-- Step 2: Add policy to allow viewing all profiles
-- This is safe because:
-- - Users only see basic profile info (name, role_id)
-- - Sensitive operations (password, etc.) are protected by API
CREATE POLICY "users_view_all_profiles" ON profiles
  FOR SELECT USING (true);

-- Verify
SELECT 
  schemaname,
  tablename,
  rowsecurity
FROM pg_tables
WHERE tablename IN ('profiles', 'roles');

SELECT 
  policyname, 
  tablename,
  cmd 
FROM pg_policies 
WHERE tablename = 'profiles' 
AND cmd = 'SELECT';

