-- Fix RLS policies to use the roles table instead of the deprecated profiles.role column
-- The profiles.role TEXT column is deprecated - we now use role_id FK to roles table
-- This migration updates all RLS policies to use: roles.is_manager_admin = true

-- ============================================
-- VEHICLE_INSPECTIONS TABLE
-- ============================================

-- Drop old policies that reference profiles.role
DROP POLICY IF EXISTS "Managers can view all inspections" ON vehicle_inspections;
DROP POLICY IF EXISTS "Managers can create inspections for users" ON vehicle_inspections;
DROP POLICY IF EXISTS "Managers can update inspections" ON vehicle_inspections;
DROP POLICY IF EXISTS "Managers and admins can delete any inspection" ON vehicle_inspections;

-- Recreate policies using roles table
CREATE POLICY "Managers can view all inspections" ON vehicle_inspections
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid() AND r.is_manager_admin = true
    )
  );

CREATE POLICY "Managers can create inspections for users" ON vehicle_inspections
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid() AND r.is_manager_admin = true
    )
  );

CREATE POLICY "Managers can update inspections" ON vehicle_inspections
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid() AND r.is_manager_admin = true
    )
    AND status = 'draft'
  );

CREATE POLICY "Managers and admins can delete any inspection" ON vehicle_inspections
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid() AND r.is_manager_admin = true
    )
  );

-- ============================================
-- INSPECTION_ITEMS TABLE
-- ============================================

DROP POLICY IF EXISTS "Managers can view all inspection items" ON inspection_items;
DROP POLICY IF EXISTS "Managers can manage all items" ON inspection_items;

CREATE POLICY "Managers can view all inspection items" ON inspection_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid() AND r.is_manager_admin = true
    )
  );

CREATE POLICY "Managers can manage all items" ON inspection_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid() AND r.is_manager_admin = true
    )
  );

-- ============================================
-- TIMESHEETS TABLE
-- ============================================

DROP POLICY IF EXISTS "Managers can view all timesheets" ON timesheets;
DROP POLICY IF EXISTS "Managers can update timesheets" ON timesheets;

CREATE POLICY "Managers can view all timesheets" ON timesheets
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid() AND r.is_manager_admin = true
    )
  );

CREATE POLICY "Managers can update timesheets" ON timesheets
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid() AND r.is_manager_admin = true
    )
  );

-- ============================================
-- TIMESHEET_ENTRIES TABLE  
-- ============================================

DROP POLICY IF EXISTS "Managers can view all timesheet entries" ON timesheet_entries;
DROP POLICY IF EXISTS "Managers can update all entries" ON timesheet_entries;

CREATE POLICY "Managers can view all timesheet entries" ON timesheet_entries
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid() AND r.is_manager_admin = true
    )
  );

CREATE POLICY "Managers can update all entries" ON timesheet_entries
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid() AND r.is_manager_admin = true
    )
  );

-- ============================================
-- ABSENCES TABLE
-- ============================================

DROP POLICY IF EXISTS "Managers can view all absences" ON absences;
DROP POLICY IF EXISTS "Managers can update absences" ON absences;

CREATE POLICY "Managers can view all absences" ON absences
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid() AND r.is_manager_admin = true
    )
  );

CREATE POLICY "Managers can update absences" ON absences
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid() AND r.is_manager_admin = true
    )
  );

-- ============================================
-- ACTIONS TABLE
-- ============================================

DROP POLICY IF EXISTS "Managers can manage all actions" ON actions;

CREATE POLICY "Managers can manage all actions" ON actions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid() AND r.is_manager_admin = true
    )
  );

-- ============================================
-- VEHICLES TABLE
-- ============================================

DROP POLICY IF EXISTS "Admins can manage vehicles" ON vehicles;

CREATE POLICY "Admins can manage vehicles" ON vehicles
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid() AND r.is_manager_admin = true
    )
  );

-- ============================================
-- PROFILES TABLE (Admin only operations)
-- ============================================

DROP POLICY IF EXISTS "Admins can update any profile" ON profiles;
DROP POLICY IF EXISTS "Managers can view all profiles" ON profiles;

CREATE POLICY "Managers can view all profiles" ON profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid() AND r.is_manager_admin = true
    )
  );

CREATE POLICY "Admins can update any profile" ON profiles
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid() AND r.is_super_admin = true
    )
    OR id = auth.uid()
  );

-- ============================================
-- RAMS_DOCUMENTS TABLE
-- ============================================

DROP POLICY IF EXISTS "Managers can view all rams documents" ON rams_documents;
DROP POLICY IF EXISTS "Managers can update rams documents" ON rams_documents;
DROP POLICY IF EXISTS "Managers can delete rams documents" ON rams_documents;

CREATE POLICY "Managers can view all rams documents" ON rams_documents
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid() AND r.is_manager_admin = true
    )
  );

CREATE POLICY "Managers can update rams documents" ON rams_documents
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid() AND r.is_manager_admin = true
    )
  );

CREATE POLICY "Managers can delete rams documents" ON rams_documents
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid() AND r.is_manager_admin = true
    )
  );

-- ============================================
-- MESSAGES TABLE
-- ============================================

DROP POLICY IF EXISTS "Admins can send to anyone" ON messages;

CREATE POLICY "Admins can send to anyone" ON messages
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid() AND r.is_manager_admin = true
    )
  );

-- ============================================
-- SYNC: Update old role column to match new role_id
-- This ensures any legacy code still works
-- ============================================

UPDATE profiles p
SET role = r.name
FROM roles r
WHERE p.role_id = r.id
AND (p.role IS NULL OR p.role != r.name);

-- Notify completion
DO $$
BEGIN
  RAISE NOTICE 'RLS policies updated to use roles table. Old role column synced.';
END $$;

