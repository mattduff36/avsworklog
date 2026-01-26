-- Migration: Add error_log_alerts table for tracking which errors have been notified
-- Date: 2026-01-26
--
-- Prevents duplicate notifications for the same error log entry

-- ============================================================================
-- Error Log Alerts Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS error_log_alerts (
  error_log_id UUID PRIMARY KEY REFERENCES error_logs(id) ON DELETE CASCADE,
  notified_at TIMESTAMPTZ DEFAULT NOW(),
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  admin_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_error_log_alerts_notified_at ON error_log_alerts(notified_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_log_alerts_message_id ON error_log_alerts(message_id);

-- Enable RLS
ALTER TABLE error_log_alerts ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- RLS Policies
-- ============================================================================

-- Super admins can view all alerts
CREATE POLICY "Super admins can view all error log alerts" ON error_log_alerts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 
      FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
        AND r.is_super_admin = true
    )
  );

-- Admins can insert alerts (via service role, but policy exists for completeness)
CREATE POLICY "Admins can create error log alerts" ON error_log_alerts
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 
      FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
        AND (r.name = 'admin' OR r.is_super_admin = true OR r.is_manager_admin = true)
    )
  );

-- ============================================================================
-- Comments
-- ============================================================================
COMMENT ON TABLE error_log_alerts IS 'Tracks which error_logs have been notified to admins to prevent duplicates';
COMMENT ON COLUMN error_log_alerts.error_log_id IS 'Reference to the error_logs entry that was notified';
COMMENT ON COLUMN error_log_alerts.message_id IS 'Reference to the notification message sent';
COMMENT ON COLUMN error_log_alerts.admin_count IS 'Number of admins notified';

-- ============================================================================
-- End of migration
-- ============================================================================
