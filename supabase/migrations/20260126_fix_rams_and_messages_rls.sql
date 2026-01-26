-- Migration: Fix RLS policies for rams_assignments and message_recipients
-- Date: 2026-01-26
-- 
-- Problem: rams_assignments and message_recipients tables were using deprecated
-- profiles.role pattern instead of the roles table with is_manager_admin flag.
-- This caused RLS violations when employees tried to update their assignments
-- and when users tried to sign messages.
--
-- Solution: Update all manager/admin policies to use the modern roles table pattern.

-- ============================================================================
-- Fix rams_assignments RLS policies
-- ============================================================================

-- Drop old policies
DROP POLICY IF EXISTS "Managers can view all assignments" ON rams_assignments;
DROP POLICY IF EXISTS "Managers can create assignments" ON rams_assignments;
DROP POLICY IF EXISTS "Employees can sign their assignments" ON rams_assignments;
DROP POLICY IF EXISTS "Managers can update assignments" ON rams_assignments;

-- Recreate with correct roles table pattern

-- Managers can view all assignments
CREATE POLICY "Managers can view all assignments" ON rams_assignments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 
      FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
        AND r.is_manager_admin = true
    )
  );

-- Managers can create assignments
CREATE POLICY "Managers can create assignments" ON rams_assignments
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 
      FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
        AND r.is_manager_admin = true
    )
  );

-- Employees can update their own assignments (for signing and action tracking)
-- Added WITH CHECK clause for better security
CREATE POLICY "Employees can sign their assignments" ON rams_assignments
  FOR UPDATE 
  USING (employee_id = auth.uid())
  WITH CHECK (employee_id = auth.uid());

-- Managers can update any assignment
CREATE POLICY "Managers can update assignments" ON rams_assignments
  FOR UPDATE 
  USING (
    EXISTS (
      SELECT 1 
      FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
        AND r.is_manager_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 
      FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
        AND r.is_manager_admin = true
    )
  );

-- ============================================================================
-- Fix message_recipients RLS policies
-- ============================================================================

-- Drop old policies
DROP POLICY IF EXISTS "Managers can view all recipients" ON message_recipients;
DROP POLICY IF EXISTS "Managers can create recipients" ON message_recipients;
DROP POLICY IF EXISTS "Users can update their recipients" ON message_recipients;
DROP POLICY IF EXISTS "Managers can update recipients" ON message_recipients;

-- Recreate with correct roles table pattern

-- Managers/admins can view all message recipient records
CREATE POLICY "Managers can view all recipients" ON message_recipients
  FOR SELECT USING (
    EXISTS (
      SELECT 1 
      FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
        AND r.is_manager_admin = true
    )
  );

-- Managers/admins can create message recipient records
CREATE POLICY "Managers can create recipients" ON message_recipients
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 
      FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
        AND r.is_manager_admin = true
    )
  );

-- Users can update their own recipient records (for signing/dismissing)
-- Added WITH CHECK clause for better security
CREATE POLICY "Users can update their recipients" ON message_recipients
  FOR UPDATE 
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Managers/admins can update any recipient record
CREATE POLICY "Managers can update recipients" ON message_recipients
  FOR UPDATE 
  USING (
    EXISTS (
      SELECT 1 
      FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
        AND r.is_manager_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 
      FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
        AND r.is_manager_admin = true
    )
  );

-- ============================================================================
-- End of migration
-- ============================================================================
