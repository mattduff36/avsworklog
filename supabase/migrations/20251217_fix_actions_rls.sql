-- Fix Actions Table RLS Policies
-- 
-- PROBLEM: Employees getting 42501 errors when inspections with defects are submitted
-- CAUSE: Policies checking deprecated profiles.role column (NULL)
-- FIX: Update to use profiles.role_id -> roles.is_manager_admin
--
-- This is the same issue that was fixed for inspection_items table

-- Drop old/broken policies that reference profiles.role
DROP POLICY IF EXISTS "Managers can view all actions" ON actions;
DROP POLICY IF EXISTS "Managers can create actions" ON actions;
DROP POLICY IF EXISTS "Managers can update actions" ON actions;
DROP POLICY IF EXISTS "Managers can delete actions" ON actions;

-- CREATE NEW POLICIES USING ROLES TABLE

-- Policy 1: SELECT - Managers can view all actions
CREATE POLICY "Managers can view all actions" ON actions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
      AND r.is_manager_admin = true
    )
  );

-- Policy 2: INSERT - Anyone can create actions (employees when submitting inspections, managers manually)
-- This is needed because when an employee submits an inspection with defects, 
-- the system auto-creates actions on their behalf
CREATE POLICY "Authenticated users can create actions" ON actions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- User must be authenticated
    auth.uid() IS NOT NULL
  );

-- Policy 3: UPDATE - Managers can update actions
CREATE POLICY "Managers can update actions" ON actions
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
      AND r.is_manager_admin = true
    )
  );

-- Policy 4: DELETE - Managers can delete actions
CREATE POLICY "Managers can delete actions" ON actions
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
      AND r.is_manager_admin = true
    )
  );
