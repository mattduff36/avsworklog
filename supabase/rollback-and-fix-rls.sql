-- URGENT FIX: Rollback problematic RLS policy and apply correct one
-- 
-- Issue: The "Users can view message senders" policy is blocking
-- users from viewing their own profile data.
-- 
-- Root cause: RLS policies use OR logic by default, but the new policy
-- might be interfering with the profile+role join.

-- Step 1: Remove the problematic policy
DROP POLICY IF EXISTS "Users can view message senders" ON profiles;

-- Step 2: Verify existing policies are intact
-- "Users can view own profile" should still exist
-- "Admins can view all profiles" should still exist

-- Step 3: Add a better policy that doesn't interfere
-- This policy allows viewing profiles that are message senders
-- It will work alongside the existing "view own profile" policy
CREATE POLICY "Allow viewing message sender profiles" ON profiles
  FOR SELECT USING (
    -- Original: Users can view their own profile (DO NOT REMOVE THIS LOGIC)
    auth.uid() = id
    OR
    -- New: Users can view profiles of people who sent them messages
    EXISTS (
      SELECT 1 
      FROM messages m
      INNER JOIN message_recipients mr ON m.id = mr.message_id
      WHERE m.sender_id = profiles.id
      AND mr.user_id = auth.uid()
    )
    OR
    -- Existing: Admins can view all profiles
    EXISTS (
      SELECT 1 FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid() 
      AND r.is_manager_admin = true
    )
  );

-- Step 4: Drop redundant policies now that we have one comprehensive policy
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;
DROP POLICY IF EXISTS "Managers can view all profiles" ON profiles;

-- Verify the policy
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive
FROM pg_policies
WHERE tablename = 'profiles'
ORDER BY policyname;

