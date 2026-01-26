-- Migration: Create generic notification_preferences table
-- Date: 2026-01-26
--
-- Purpose: Unified notification preferences system supporting multiple modules
-- (errors, maintenance, rams, approvals, inspections) with per-channel toggles.

-- ============================================================================
-- Notification Preferences Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS notification_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL CHECK (module_key IN ('errors', 'maintenance', 'rams', 'approvals', 'inspections')),
  enabled BOOLEAN DEFAULT true,
  notify_in_app BOOLEAN DEFAULT true,
  notify_email BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, module_key)
);

-- ============================================================================
-- Indexes
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_notification_preferences_user_id ON notification_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_preferences_module ON notification_preferences(module_key);
CREATE INDEX IF NOT EXISTS idx_notification_preferences_user_module ON notification_preferences(user_id, module_key);

-- ============================================================================
-- Enable RLS
-- ============================================================================
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- RLS Policies
-- ============================================================================

-- Users can view their own preferences
CREATE POLICY "Users can view own notification preferences"
  ON notification_preferences
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Users can insert their own preferences
CREATE POLICY "Users can insert own notification preferences"
  ON notification_preferences
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Users can update their own preferences
CREATE POLICY "Users can update own notification preferences"
  ON notification_preferences
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Super admins can view all preferences
CREATE POLICY "Super admins can view all notification preferences"
  ON notification_preferences
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
      AND r.is_super_admin = TRUE
    )
  );

-- Super admins can update any user's preferences (override)
CREATE POLICY "Super admins can update all notification preferences"
  ON notification_preferences
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
      AND r.is_super_admin = TRUE
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
      AND r.is_super_admin = TRUE
    )
  );

-- ============================================================================
-- Updated_at Trigger
-- ============================================================================
DROP TRIGGER IF EXISTS update_notification_preferences_updated_at ON notification_preferences;
CREATE TRIGGER update_notification_preferences_updated_at
  BEFORE UPDATE ON notification_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Migrate existing admin_error_notification_prefs data
-- ============================================================================

-- Insert existing error prefs into new table (if they exist)
INSERT INTO notification_preferences (user_id, module_key, enabled, notify_in_app, notify_email, created_at, updated_at)
SELECT 
  user_id,
  'errors' as module_key,
  true as enabled,
  notify_in_app,
  notify_email,
  created_at,
  updated_at
FROM admin_error_notification_prefs
ON CONFLICT (user_id, module_key) DO UPDATE SET
  notify_in_app = EXCLUDED.notify_in_app,
  notify_email = EXCLUDED.notify_email,
  updated_at = EXCLUDED.updated_at;

-- ============================================================================
-- Comments
-- ============================================================================
COMMENT ON TABLE notification_preferences IS 'User notification preferences per module (errors, maintenance, rams, approvals, inspections)';
COMMENT ON COLUMN notification_preferences.module_key IS 'Module identifier: errors, maintenance, rams, approvals, inspections';
COMMENT ON COLUMN notification_preferences.enabled IS 'Whether this notification type is enabled for the user';
COMMENT ON COLUMN notification_preferences.notify_in_app IS 'Whether to show in-app notifications';
COMMENT ON COLUMN notification_preferences.notify_email IS 'Whether to send email notifications';

-- ============================================================================
-- End of migration
-- ============================================================================
