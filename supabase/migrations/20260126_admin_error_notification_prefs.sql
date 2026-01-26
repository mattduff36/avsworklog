-- Migration: Add admin error notification preferences
-- Date: 2026-01-26
--
-- Allows admins to opt in/out of receiving notifications and emails
-- when new error reports are submitted or detected by /debug

-- ============================================================================
-- Admin Error Notification Preferences Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS admin_error_notification_prefs (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  notify_in_app BOOLEAN DEFAULT true,
  notify_email BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_admin_error_notification_prefs_user ON admin_error_notification_prefs(user_id);

-- Enable RLS
ALTER TABLE admin_error_notification_prefs ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- RLS Policies
-- ============================================================================

-- Admins can view their own preferences
CREATE POLICY "Admins can view own error notification preferences" ON admin_error_notification_prefs
  FOR SELECT USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 
      FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
        AND (r.name = 'admin' OR r.is_super_admin = true OR r.is_manager_admin = true)
    )
  );

-- Admins can insert their own preferences
CREATE POLICY "Admins can insert own error notification preferences" ON admin_error_notification_prefs
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 
      FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
        AND (r.name = 'admin' OR r.is_super_admin = true OR r.is_manager_admin = true)
    )
  );

-- Admins can update their own preferences
CREATE POLICY "Admins can update own error notification preferences" ON admin_error_notification_prefs
  FOR UPDATE USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 
      FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
        AND (r.name = 'admin' OR r.is_super_admin = true OR r.is_manager_admin = true)
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 
      FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
        AND (r.name = 'admin' OR r.is_super_admin = true OR r.is_manager_admin = true)
    )
  );

-- Super admins can view all preferences (optional, for monitoring)
CREATE POLICY "Super admins can view all error notification preferences" ON admin_error_notification_prefs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 
      FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
        AND r.is_super_admin = true
    )
  );

-- ============================================================================
-- Updated_at Trigger
-- ============================================================================
DROP TRIGGER IF EXISTS update_admin_error_notification_prefs_updated_at ON admin_error_notification_prefs;
CREATE TRIGGER update_admin_error_notification_prefs_updated_at
  BEFORE UPDATE ON admin_error_notification_prefs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Comments
-- ============================================================================
COMMENT ON TABLE admin_error_notification_prefs IS 'Admin preferences for error report notifications (in-app and email)';
COMMENT ON COLUMN admin_error_notification_prefs.notify_in_app IS 'Whether admin wants in-app notifications for new error reports';
COMMENT ON COLUMN admin_error_notification_prefs.notify_email IS 'Whether admin wants email notifications for new error reports';

-- ============================================================================
-- End of migration
-- ============================================================================
