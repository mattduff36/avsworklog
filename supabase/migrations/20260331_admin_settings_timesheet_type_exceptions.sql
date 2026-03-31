BEGIN;

INSERT INTO permission_modules (module_name, minimum_role_id, sort_order)
SELECT
  'admin-settings',
  roles.id,
  175
FROM roles
WHERE roles.name = 'manager'
ON CONFLICT (module_name) DO UPDATE
SET
  minimum_role_id = EXCLUDED.minimum_role_id,
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();

INSERT INTO team_module_permissions (team_id, module_name, enabled)
SELECT
  org_teams.id,
  'admin-settings',
  FALSE
FROM org_teams
ON CONFLICT (team_id, module_name) DO UPDATE
SET
  enabled = EXCLUDED.enabled,
  updated_at = NOW();

INSERT INTO role_permissions (role_id, module_name, enabled)
SELECT
  roles.id,
  'admin-settings',
  FALSE
FROM roles
ON CONFLICT (role_id, module_name) DO NOTHING;

CREATE TABLE IF NOT EXISTS timesheet_type_exceptions (
  profile_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  timesheet_type TEXT NULL CHECK (timesheet_type IN ('civils', 'plant')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NULL REFERENCES profiles(id) ON DELETE SET NULL,
  updated_by UUID NULL REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_timesheet_type_exceptions_type
  ON timesheet_type_exceptions(timesheet_type);

ALTER TABLE timesheet_type_exceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read timesheet type exceptions" ON timesheet_type_exceptions;
CREATE POLICY "Users can read timesheet type exceptions"
  ON timesheet_type_exceptions
  FOR SELECT
  TO authenticated
  USING (
    profile_id = auth.uid()
    OR effective_has_module_permission('approvals')
    OR effective_has_module_permission('admin-users')
    OR effective_has_module_permission('admin-settings')
  );

DROP POLICY IF EXISTS "Only admins can manage timesheet type exceptions" ON timesheet_type_exceptions;
CREATE POLICY "Only admins can manage timesheet type exceptions"
  ON timesheet_type_exceptions
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM profiles p
      JOIN roles r ON r.id = p.role_id
      WHERE p.id = auth.uid()
        AND (r.is_super_admin = TRUE OR r.name = 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM profiles p
      JOIN roles r ON r.id = p.role_id
      WHERE p.id = auth.uid()
        AND (r.is_super_admin = TRUE OR r.name = 'admin')
    )
  );

COMMIT;
