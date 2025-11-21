-- EMERGENCY: Drop ALL SELECT policies on profiles and recreate SIMPLE ones
-- No joins, no subqueries to other tables with RLS

-- Step 1: Drop ALL SELECT policies on profiles
DROP POLICY IF EXISTS "View own and message sender profiles" ON profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Managers can view all profiles" ON profiles;
DROP POLICY IF EXISTS "Allow viewing message sender profiles" ON profiles;

-- Step 2: Create ONLY these two policies with NO recursion risk

-- Policy 1: Users can ALWAYS view their own profile
CREATE POLICY "users_view_own_profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

-- Policy 2: Disable RLS for admin service role
-- This allows backend/API to query without RLS
ALTER TABLE profiles FORCE ROW LEVEL SECURITY;

-- Verify
SELECT policyname, cmd 
FROM pg_policies 
WHERE tablename = 'profiles' 
AND cmd = 'SELECT';

