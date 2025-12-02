-- Fix additional RLS issues found in error logs
-- 1. Actions table - employees/managers need insert
-- 2. Vehicles table - employees need insert (for adding new vehicles from inspection form)

-- ========================================
-- PART 1: Actions table RLS
-- ========================================

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view own actions" ON actions;
DROP POLICY IF EXISTS "Users can create actions" ON actions;
DROP POLICY IF EXISTS "Managers can view all actions" ON actions;
DROP POLICY IF EXISTS "Managers can create actions" ON actions;
DROP POLICY IF EXISTS "Managers can update actions" ON actions;

-- Policy: Users can view actions they created or actioned, managers see all
CREATE POLICY "Users can view own actions" ON actions
  FOR SELECT USING (
    auth.uid() = created_by 
    OR auth.uid() = actioned_by
    OR EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role_id IN (
        SELECT id FROM roles WHERE is_manager_admin = true
      )
    )
  );

-- Policy: Any authenticated user can create actions (for auto-creation from inspections)
CREATE POLICY "Users can create actions" ON actions
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL
  );

-- Policy: Managers can update any action
CREATE POLICY "Managers can update actions" ON actions
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role_id IN (
        SELECT id FROM roles WHERE is_manager_admin = true
      )
    )
  );

-- Policy: Users can update actions they created
CREATE POLICY "Users can update own actions" ON actions
  FOR UPDATE USING (
    auth.uid() = created_by
  );

-- Policy: Managers can delete actions
CREATE POLICY "Managers can delete actions" ON actions
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role_id IN (
        SELECT id FROM roles WHERE is_manager_admin = true
      )
    )
  );

-- ========================================
-- PART 2: Vehicles table RLS (allow employees to add vehicles)
-- ========================================

-- Drop and recreate vehicle policies
DROP POLICY IF EXISTS "All users can view active vehicles" ON vehicles;
DROP POLICY IF EXISTS "Admins can manage vehicles" ON vehicles;
DROP POLICY IF EXISTS "Users can add vehicles" ON vehicles;

-- Anyone authenticated can view active vehicles
CREATE POLICY "All users can view active vehicles" ON vehicles
  FOR SELECT USING (
    status = 'active' OR EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role_id IN (
        SELECT id FROM roles WHERE is_manager_admin = true
      )
    )
  );

-- Any authenticated user can INSERT vehicles (for adding from inspection form)
CREATE POLICY "Users can add vehicles" ON vehicles
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL
  );

-- Only admins can UPDATE vehicles
CREATE POLICY "Admins can update vehicles" ON vehicles
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role_id IN (
        SELECT id FROM roles WHERE name = 'admin'
      )
    )
  );

-- Only admins can DELETE vehicles
CREATE POLICY "Admins can delete vehicles" ON vehicles
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role_id IN (
        SELECT id FROM roles WHERE name = 'admin'
      )
    )
  );

-- ========================================
-- VERIFICATION
-- ========================================

-- Show actions policies
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'actions' ORDER BY cmd;

-- Show vehicles policies
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'vehicles' ORDER BY cmd;

