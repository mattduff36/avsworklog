BEGIN;

-- Re-enable hidden HGV drafts so photo uploads can auto-persist.
ALTER TABLE hgv_inspections
  DROP CONSTRAINT IF EXISTS hgv_inspections_status_check;

ALTER TABLE hgv_inspections
  ADD CONSTRAINT hgv_inspections_status_check
  CHECK (status IN ('draft', 'submitted'));

-- Mirror van draft transition behavior: only draft rows are editable.
DROP POLICY IF EXISTS "Users can update own hgv inspections" ON hgv_inspections;
CREATE POLICY "Users can update own hgv inspections" ON hgv_inspections
  FOR UPDATE TO authenticated
  USING (
    (user_id = auth.uid() OR effective_is_manager_admin())
    AND status = 'draft'
  )
  WITH CHECK (
    (user_id = auth.uid() OR effective_is_manager_admin())
    AND status IN ('draft', 'submitted')
  );

-- Allow draft discard without granting deletion of submitted checks.
DROP POLICY IF EXISTS "Users can delete own draft hgv inspections" ON hgv_inspections;
CREATE POLICY "Users can delete own draft hgv inspections" ON hgv_inspections
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND status = 'draft');

DROP POLICY IF EXISTS "Managers can delete draft hgv inspections" ON hgv_inspections;
CREATE POLICY "Managers can delete draft hgv inspections" ON hgv_inspections
  FOR DELETE TO authenticated
  USING (effective_is_manager_admin() AND status = 'draft');

COMMIT;
