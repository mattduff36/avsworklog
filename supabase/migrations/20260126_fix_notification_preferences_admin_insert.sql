-- Migration: Fix notification_preferences RLS for admin inserts
-- Date: 2026-01-26
--
-- Purpose: Allow admins to insert notification preferences for any user
-- (needed for upsert operations in admin override functionality)

-- ============================================================================
-- Add admin INSERT policy
-- ============================================================================

-- Admins can insert preferences for any user
CREATE POLICY notification_preferences_admin_insert
  ON notification_preferences
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
        AND (r.is_super_admin = true OR r.is_manager_admin = true)
    )
  );

-- ============================================================================
-- Verification
-- ============================================================================

-- List all policies on notification_preferences
DO $$
BEGIN
  RAISE NOTICE 'Notification preferences policies created successfully';
  RAISE NOTICE 'Policies now include: SELECT (own + admin), INSERT (own + admin), UPDATE (own + admin)';
END $$;
