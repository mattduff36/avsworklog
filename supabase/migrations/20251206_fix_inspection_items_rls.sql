-- Migration: Fix inspection_items RLS policies to use roles table
-- Date: 2025-12-06
-- 
-- PROBLEM:
-- The inspection_items table has INSERT policies that check the deprecated
-- profiles.role column (e.g., role IN ('manager', 'admin')). The system has
-- migrated to use profiles.role_id -> roles.id -> roles.is_manager_admin.
-- When managers try to insert inspection items, the policy fails because
-- profiles.role is NULL/deprecated, causing 42501 RLS violations.
--
-- SOLUTION:
-- Update all inspection_items RLS policies to use the roles table structure,
-- consistent with other tables in the system (see fix-rls-to-use-roles-table.sql).

-- ============================================
-- INSPECTION_ITEMS TABLE - FIX RLS POLICIES
-- ============================================

-- Drop all existing policies for inspection_items
DROP POLICY IF EXISTS "Users can manage own inspection items" ON inspection_items;
DROP POLICY IF EXISTS "Employees can view own inspection items" ON inspection_items;
DROP POLICY IF EXISTS "Employees can insert own inspection items" ON inspection_items;
DROP POLICY IF EXISTS "Employees can update own inspection items" ON inspection_items;
DROP POLICY IF EXISTS "Employees can delete own inspection items" ON inspection_items;
DROP POLICY IF EXISTS "Managers can view all inspection items" ON inspection_items;
DROP POLICY IF EXISTS "Managers can insert all inspection items" ON inspection_items;
DROP POLICY IF EXISTS "Managers can update all inspection items" ON inspection_items;
DROP POLICY IF EXISTS "Managers can delete all inspection items" ON inspection_items;
DROP POLICY IF EXISTS "Managers can manage all items" ON inspection_items;

-- ============================================
-- SELECT POLICIES (View)
-- ============================================

-- Employees can view their own inspection items
CREATE POLICY "Employees can view own inspection items" ON inspection_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM vehicle_inspections vi
      WHERE vi.id = inspection_items.inspection_id
      AND vi.user_id = auth.uid()
    )
  );

-- Managers can view all inspection items
CREATE POLICY "Managers can view all inspection items" ON inspection_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid() AND r.is_manager_admin = true
    )
  );

-- ============================================
-- INSERT POLICIES (Create)
-- ============================================

-- Employees can insert items for their own inspections only
CREATE POLICY "Employees can insert own inspection items" ON inspection_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM vehicle_inspections vi
      WHERE vi.id = inspection_items.inspection_id
      AND vi.user_id = auth.uid()
    )
  );

-- Managers can insert items for any inspection
-- This allows managers to create inspections on behalf of employees
CREATE POLICY "Managers can insert all inspection items" ON inspection_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid() AND r.is_manager_admin = true
    )
  );

-- ============================================
-- UPDATE POLICIES (Edit)
-- ============================================

-- Employees can update items in their own draft inspections
CREATE POLICY "Employees can update own inspection items" ON inspection_items
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM vehicle_inspections vi
      WHERE vi.id = inspection_items.inspection_id
      AND vi.user_id = auth.uid()
      AND vi.status = 'draft'
    )
  );

-- Managers can update any inspection items
CREATE POLICY "Managers can update all inspection items" ON inspection_items
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid() AND r.is_manager_admin = true
    )
  );

-- ============================================
-- DELETE POLICIES (Remove)
-- ============================================

-- Employees can delete items from their own draft inspections
CREATE POLICY "Employees can delete own inspection items" ON inspection_items
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM vehicle_inspections vi
      WHERE vi.id = inspection_items.inspection_id
      AND vi.user_id = auth.uid()
      AND vi.status = 'draft'
    )
  );

-- Managers can delete any inspection items
CREATE POLICY "Managers can delete all inspection items" ON inspection_items
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid() AND r.is_manager_admin = true
    )
  );

-- ============================================
-- VERIFICATION
-- ============================================

-- List all policies for inspection_items to verify
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'inspection_items'
ORDER BY policyname;

-- Notify completion
DO $$
BEGIN
  RAISE NOTICE 'inspection_items RLS policies fixed to use roles table';
  RAISE NOTICE 'Managers can now create inspection items for any user';
  RAISE NOTICE 'Employees can create/edit items for their own inspections';
END $$;
