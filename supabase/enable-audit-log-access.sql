-- Enable RLS and create policies for audit_log table
-- This allows the debug page to access audit logs

-- Enable Row Level Security
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Policy: SuperAdmins can view all audit logs
CREATE POLICY "SuperAdmins can view all audit logs" ON audit_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM auth.users 
      WHERE auth.users.id = auth.uid() 
      AND auth.users.email = 'admin@mpdee.co.uk'
    )
  );

-- Policy: Admins and Managers can view audit logs
CREATE POLICY "Admins and Managers can view audit logs" ON audit_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.role IN ('admin', 'manager')
    )
  );

-- Policy: System can insert audit logs (for triggers)
CREATE POLICY "System can insert audit logs" ON audit_log
  FOR INSERT WITH CHECK (true);

