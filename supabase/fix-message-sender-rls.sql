-- Fix RLS Policy to Allow Users to See Message Senders
-- 
-- Issue: Employees can't see manager/admin names in notifications
-- because RLS policies prevent them from viewing manager/admin profiles.
-- 
-- Solution: Add a policy that allows users to view the profile of anyone
-- who has sent them a message.

-- Add policy to allow viewing message senders
DROP POLICY IF EXISTS "Users can view message senders" ON profiles;

CREATE POLICY "Users can view message senders" ON profiles
  FOR SELECT USING (
    -- Allow if this profile is a sender of a message assigned to the current user
    EXISTS (
      SELECT 1 
      FROM messages m
      INNER JOIN message_recipients mr ON m.id = mr.message_id
      WHERE m.sender_id = profiles.id
      AND mr.user_id = auth.uid()
    )
  );

-- Verify the policy was created
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies
WHERE tablename = 'profiles'
AND policyname = 'Users can view message senders';

