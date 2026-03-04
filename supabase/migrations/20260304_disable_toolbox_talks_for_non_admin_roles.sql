-- Disable toolbox-talks permission for non-admin/non-manager roles.
-- Toolbox Talks is a management-only module: only admins/managers can send talks.
-- All users still receive talks via notifications regardless of this permission.

UPDATE role_permissions
SET enabled = false, updated_at = now()
WHERE module_name = 'toolbox-talks'
  AND role_id IN (
    SELECT id FROM roles
    WHERE is_super_admin = false
      AND is_manager_admin = false
  );
