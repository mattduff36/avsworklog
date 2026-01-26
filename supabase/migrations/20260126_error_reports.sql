-- Error Reports System Migration
-- Creates tables for user-reported errors with admin management
-- Date: 2026-01-26

-- ============================================
-- Error Reports Table
-- ============================================
CREATE TABLE IF NOT EXISTS error_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_by UUID NOT NULL REFERENCES auth.users(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  error_code TEXT,
  page_url TEXT,
  user_agent TEXT,
  additional_context JSONB,
  status TEXT CHECK (status IN ('new', 'investigating', 'resolved')) DEFAULT 'new',
  admin_notes TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id),
  notification_message_id UUID REFERENCES messages(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Error Report Updates (Audit Trail)
-- ============================================
CREATE TABLE IF NOT EXISTS error_report_updates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  error_report_id UUID NOT NULL REFERENCES error_reports(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  old_status TEXT,
  new_status TEXT,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Indexes
-- ============================================
CREATE INDEX IF NOT EXISTS idx_error_reports_created_by ON error_reports(created_by);
CREATE INDEX IF NOT EXISTS idx_error_reports_status ON error_reports(status);
CREATE INDEX IF NOT EXISTS idx_error_reports_created_at ON error_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_reports_resolved_by ON error_reports(resolved_by);
CREATE INDEX IF NOT EXISTS idx_error_report_updates_report_id ON error_report_updates(error_report_id);

-- ============================================
-- Enable RLS
-- ============================================
ALTER TABLE error_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE error_report_updates ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLS Policies for error_reports
-- ============================================

-- Users can view their own error reports
CREATE POLICY "Users can view own error reports"
  ON error_reports
  FOR SELECT
  TO authenticated
  USING (created_by = auth.uid());

-- Users can create error reports
CREATE POLICY "Authenticated users can create error reports"
  ON error_reports
  FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

-- Admins can view all error reports
CREATE POLICY "Admins can view all error reports"
  ON error_reports
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
      AND (r.name = 'admin' OR r.is_super_admin = TRUE)
    )
  );

-- Admins can update error reports (status, admin_notes, resolved_at, resolved_by)
CREATE POLICY "Admins can update error reports"
  ON error_reports
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
      AND (r.name = 'admin' OR r.is_super_admin = TRUE)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
      AND (r.name = 'admin' OR r.is_super_admin = TRUE)
    )
  );

-- ============================================
-- RLS Policies for error_report_updates
-- ============================================

-- Users can see updates on their own error reports
CREATE POLICY "Users can view updates on own error reports"
  ON error_report_updates
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM error_reports er
      WHERE er.id = error_report_updates.error_report_id
      AND er.created_by = auth.uid()
    )
  );

-- Admins can see all updates
CREATE POLICY "Admins can view all error report updates"
  ON error_report_updates
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
      AND (r.name = 'admin' OR r.is_super_admin = TRUE)
    )
  );

-- Admins can create updates
CREATE POLICY "Admins can create error report updates"
  ON error_report_updates
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
      AND (r.name = 'admin' OR r.is_super_admin = TRUE)
    )
  );

-- ============================================
-- Updated_at Trigger
-- ============================================

-- Error reports trigger
DROP TRIGGER IF EXISTS update_error_reports_updated_at ON error_reports;
CREATE TRIGGER update_error_reports_updated_at
  BEFORE UPDATE ON error_reports
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Comments
-- ============================================
COMMENT ON TABLE error_reports IS 'User-reported errors for admin investigation and resolution';
COMMENT ON TABLE error_report_updates IS 'Audit trail for error report status changes';
COMMENT ON COLUMN error_reports.error_code IS 'Optional error code for tracking';
COMMENT ON COLUMN error_reports.additional_context IS 'JSON object with additional error context';
COMMENT ON COLUMN error_reports.admin_notes IS 'Internal notes from admins (not visible to reporter)';
COMMENT ON COLUMN error_reports.notification_message_id IS 'Reference to the notification message sent to admins';
