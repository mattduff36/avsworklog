BEGIN;

-- Re-enable hidden Plant drafts for photo auto-save and draft lifecycle parity.
ALTER TABLE plant_inspections
  DROP CONSTRAINT IF EXISTS plant_inspections_not_draft;

ALTER TABLE plant_inspections
  DROP CONSTRAINT IF EXISTS plant_inspections_status_check;

ALTER TABLE plant_inspections
  DROP CONSTRAINT IF EXISTS vehicle_inspections_status_check;

ALTER TABLE plant_inspections
  ADD CONSTRAINT plant_inspections_status_check
  CHECK (status IN ('draft', 'submitted'));

-- Allow draft edits by owner and managers, but keep submitted rows immutable.
DROP POLICY IF EXISTS "Managers can update plant inspections" ON plant_inspections;
DROP POLICY IF EXISTS "Users can update own plant inspections" ON plant_inspections;
CREATE POLICY "Users can update own plant inspections" ON plant_inspections
  FOR UPDATE TO authenticated
  USING (
    (user_id = auth.uid() OR effective_is_manager_admin())
    AND status = 'draft'
  )
  WITH CHECK (
    (user_id = auth.uid() OR effective_is_manager_admin())
    AND status IN ('draft', 'submitted')
  );

-- Allow owners/managers to discard drafts without opening submitted delete access.
DROP POLICY IF EXISTS "Users can delete own draft plant inspections" ON plant_inspections;
CREATE POLICY "Users can delete own draft plant inspections" ON plant_inspections
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND status = 'draft');

DROP POLICY IF EXISTS "Managers can delete draft plant inspections" ON plant_inspections;
CREATE POLICY "Managers can delete draft plant inspections" ON plant_inspections
  FOR DELETE TO authenticated
  USING (effective_is_manager_admin() AND status = 'draft');

COMMIT;
