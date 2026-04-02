BEGIN;

CREATE OR REPLACE FUNCTION public.effective_is_supervisor()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM roles
    WHERE id = effective_role_id()
      AND lower(name) = 'supervisor'
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

DROP POLICY IF EXISTS "Supervisors can view all van inspections" ON van_inspections;
CREATE POLICY "Supervisors can view all van inspections" ON van_inspections
  FOR SELECT TO authenticated
  USING (
    effective_is_supervisor()
    AND effective_has_module_permission('inspections')
  );

DROP POLICY IF EXISTS "Supervisors can view all plant inspections" ON plant_inspections;
CREATE POLICY "Supervisors can view all plant inspections" ON plant_inspections
  FOR SELECT TO authenticated
  USING (
    effective_is_supervisor()
    AND effective_has_module_permission('plant-inspections')
  );

DROP POLICY IF EXISTS "Supervisors can view all hgv inspections" ON hgv_inspections;
CREATE POLICY "Supervisors can view all hgv inspections" ON hgv_inspections
  FOR SELECT TO authenticated
  USING (
    effective_is_supervisor()
    AND effective_has_module_permission('hgv-inspections')
  );

DROP POLICY IF EXISTS "Supervisors can view all inspection items" ON inspection_items;
CREATE POLICY "Supervisors can view all inspection items" ON inspection_items
  FOR SELECT TO authenticated
  USING (
    effective_is_supervisor()
    AND (
      effective_has_module_permission('inspections')
      OR effective_has_module_permission('plant-inspections')
      OR effective_has_module_permission('hgv-inspections')
    )
  );

DROP POLICY IF EXISTS "Supervisors can view all inspection daily hours" ON inspection_daily_hours;
CREATE POLICY "Supervisors can view all inspection daily hours" ON inspection_daily_hours
  FOR SELECT TO authenticated
  USING (
    effective_is_supervisor()
    AND (
      effective_has_module_permission('inspections')
      OR effective_has_module_permission('plant-inspections')
      OR effective_has_module_permission('hgv-inspections')
    )
  );

DROP POLICY IF EXISTS "Supervisors can view all inspection photos" ON inspection_photos;
CREATE POLICY "Supervisors can view all inspection photos" ON inspection_photos
  FOR SELECT TO authenticated
  USING (
    effective_is_supervisor()
    AND (
      effective_has_module_permission('inspections')
      OR effective_has_module_permission('plant-inspections')
      OR effective_has_module_permission('hgv-inspections')
    )
  );

COMMIT;
