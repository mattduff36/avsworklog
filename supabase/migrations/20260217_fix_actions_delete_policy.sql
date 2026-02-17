-- Fix Actions Delete Policy
-- 
-- PROBLEM: Users (including SuperAdmins) cannot delete workshop tasks
-- CAUSE: Migration 20260212_view_as_effective_role.sql dropped the DELETE policy
--        but never recreated it
-- FIX: Add the missing DELETE policy for actions table
--
-- This policy allows managers/admins to delete workshop tasks

CREATE POLICY "Managers can delete actions" ON actions
FOR DELETE USING ( effective_is_manager_admin() );
