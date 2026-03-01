-- Add hgv-inspections role permission rows, mirroring plant-inspections defaults.

BEGIN;

INSERT INTO role_permissions (role_id, module_name, enabled)
SELECT rp.role_id, 'hgv-inspections', rp.enabled
FROM role_permissions rp
WHERE rp.module_name = 'plant-inspections'
  AND NOT EXISTS (
    SELECT 1
    FROM role_permissions existing
    WHERE existing.role_id = rp.role_id
      AND existing.module_name = 'hgv-inspections'
  );

COMMIT;
