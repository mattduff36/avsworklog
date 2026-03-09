-- =============================================================================
-- Expand management module taxonomy for RBAC matrix
-- Adds role_permissions rows for:
--   - suggestions
--   - faq-editor
--   - error-reports
-- and backfills any missing role_permissions rows for all modules.
-- =============================================================================

BEGIN;

WITH all_modules AS (
  SELECT unnest(ARRAY[
    'timesheets',
    'inspections',
    'plant-inspections',
    'hgv-inspections',
    'rams',
    'absence',
    'maintenance',
    'toolbox-talks',
    'workshop-tasks',
    'approvals',
    'actions',
    'reports',
    'suggestions',
    'faq-editor',
    'error-reports',
    'admin-users',
    'admin-vans',
    'customers',
    'quotes'
  ]::text[]) AS module_name
),
missing AS (
  SELECT
    r.id AS role_id,
    m.module_name
  FROM roles r
  CROSS JOIN all_modules m
  LEFT JOIN role_permissions rp
    ON rp.role_id = r.id
   AND rp.module_name = m.module_name
  WHERE rp.id IS NULL
)
INSERT INTO role_permissions (role_id, module_name, enabled)
SELECT
  missing.role_id,
  missing.module_name,
  FALSE
FROM missing;

DO $$
BEGIN
  RAISE NOTICE 'RBAC taxonomy expanded: suggestions, faq-editor, error-reports';
  RAISE NOTICE 'Missing role_permissions rows have been backfilled for all roles/modules.';
END $$;

COMMIT;
