-- Migration: Fix RLS policies for messages table
-- Date: 2026-01-26
-- 
-- Problem: messages table is using deprecated profiles.role pattern instead of
-- the roles table with is_manager_admin flag. This causes RLS violations when
-- users try to view messages they are recipients of, breaking the notification system.
--
-- Solution: Update all manager/admin policies to use the modern roles table pattern.

-- ============================================================================
-- Fix messages RLS policies
-- ============================================================================

-- Drop old policies that use profiles.role
DROP POLICY IF EXISTS "Managers can view their messages" ON messages;
DROP POLICY IF EXISTS "Managers can create messages" ON messages;
DROP POLICY IF EXISTS "Managers can update messages" ON messages;

-- Recreate with correct roles table pattern

-- Managers/admins can view all messages (for management)
CREATE POLICY "Managers can view all messages" ON messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 
      FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
        AND r.is_manager_admin = true
    )
  );

-- Users can view messages where they are a recipient
-- This policy already exists and is correct, keeping it as-is
-- CREATE POLICY "Users can view assigned messages" ON messages ...

-- Managers/admins can create messages
CREATE POLICY "Managers can create messages" ON messages
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 
      FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
        AND r.is_manager_admin = true
    )
  );

-- Managers/admins can update messages (for soft delete)
CREATE POLICY "Managers can update messages" ON messages
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
