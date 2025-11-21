-- CRITICAL FIX: Remove infinite recursion in RLS policy
-- 
-- The policy is querying profiles table WITHIN the profiles RLS policy
-- causing infinite recursion. Must remove the problematic check.

-- Step 1: Drop the broken policy
DROP POLICY IF EXISTS "Allow viewing message sender profiles" ON profiles;

-- Step 2: Create policy WITHOUT the recursive profiles check
-- This policy allows:
-- 1. Users to view their own profile
-- 2. Users to view profiles of message senders (no recursion here)
CREATE POLICY "View own and message sender profiles" ON profiles
  FOR SELECT USING (
    -- Users can view their own profile
    auth.uid() = id
    OR
    -- Users can view profiles of people who sent them messages
    EXISTS (
      SELECT 1 
      FROM messages m
      INNER JOIN message_recipients mr ON m.id = mr.message_id
      WHERE m.sender_id = profiles.id
      AND mr.user_id = auth.uid()
    )
  );

-- Step 3: Restore the separate admin view all policy using JWT metadata
-- This avoids querying profiles table
CREATE POLICY "Admins can view all profiles" ON profiles
  FOR SELECT USING (
    -- Check role from JWT metadata to avoid recursion
    (auth.jwt() -> 'user_metadata' ->> 'role') IN ('admin', 'manager')
  );

-- Verify policies
SELECT 
  policyname,
  cmd
FROM pg_policies
WHERE tablename = 'profiles'
AND cmd = 'SELECT'
ORDER BY policyname;

