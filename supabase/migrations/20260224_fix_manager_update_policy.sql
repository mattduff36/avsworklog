-- Hotfix: Replace deprecated profiles.role pattern with effective_is_manager_admin()
-- in the "Managers can update inspections" RLS policy on vehicle_inspections.
-- The 20260224_plant_inspections_no_draft migration regressed this policy from
-- the correct pattern set in 20260212_view_as_effective_role.

BEGIN;

DROP POLICY IF EXISTS "Managers can update inspections" ON vehicle_inspections;

CREATE POLICY "Managers can update inspections" ON vehicle_inspections
  FOR UPDATE
  TO authenticated
  USING (
    effective_is_manager_admin()
    AND status = 'draft'
    AND plant_id IS NULL
    AND is_hired_plant = FALSE
  );

COMMIT;
