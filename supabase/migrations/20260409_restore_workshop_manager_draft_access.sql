BEGIN;

DROP POLICY IF EXISTS "Managers can update inspections" ON public.van_inspections;
CREATE POLICY "Managers can update inspections"
  ON public.van_inspections
  FOR UPDATE
  TO authenticated
  USING (
    (SELECT effective_is_manager_admin())
    AND status = 'draft'
  )
  WITH CHECK (
    (SELECT effective_is_manager_admin())
    AND status IN ('draft', 'submitted')
  );

DROP POLICY IF EXISTS "Users can update own plant inspections" ON public.plant_inspections;
CREATE POLICY "Users can update own plant inspections"
  ON public.plant_inspections
  FOR UPDATE
  TO authenticated
  USING (
    (
      user_id = (SELECT auth.uid())
      OR (SELECT effective_is_manager_admin())
    )
    AND status = 'draft'
  )
  WITH CHECK (
    (
      user_id = (SELECT auth.uid())
      OR (SELECT effective_is_manager_admin())
    )
    AND status IN ('draft', 'submitted')
  );

DROP POLICY IF EXISTS "Managers can delete draft plant inspections" ON public.plant_inspections;
CREATE POLICY "Managers can delete draft plant inspections"
  ON public.plant_inspections
  FOR DELETE
  TO authenticated
  USING (
    (SELECT effective_is_manager_admin())
    AND status = 'draft'
  );

DROP POLICY IF EXISTS "Users can update own hgv inspections" ON public.hgv_inspections;
CREATE POLICY "Users can update own hgv inspections"
  ON public.hgv_inspections
  FOR UPDATE
  TO authenticated
  USING (
    (
      user_id = (SELECT auth.uid())
      OR (SELECT effective_is_manager_admin())
    )
    AND status = 'draft'
  )
  WITH CHECK (
    (
      user_id = (SELECT auth.uid())
      OR (SELECT effective_is_manager_admin())
    )
    AND status IN ('draft', 'submitted')
  );

DROP POLICY IF EXISTS "Managers can delete draft hgv inspections" ON public.hgv_inspections;
CREATE POLICY "Managers can delete draft hgv inspections"
  ON public.hgv_inspections
  FOR DELETE
  TO authenticated
  USING (
    (SELECT effective_is_manager_admin())
    AND status = 'draft'
  );

DROP POLICY IF EXISTS "Managers can manage all items" ON public.inspection_items;
CREATE POLICY "Managers can manage all items"
  ON public.inspection_items
  FOR ALL
  TO authenticated
  USING ((SELECT effective_is_manager_admin()))
  WITH CHECK ((SELECT effective_is_manager_admin()));

DROP POLICY IF EXISTS "Managers can delete all inspection daily hours" ON public.inspection_daily_hours;
CREATE POLICY "Managers can delete all inspection daily hours"
  ON public.inspection_daily_hours
  FOR DELETE
  TO authenticated
  USING ((SELECT effective_is_manager_admin()));

DROP POLICY IF EXISTS "Managers can insert all inspection daily hours" ON public.inspection_daily_hours;
CREATE POLICY "Managers can insert all inspection daily hours"
  ON public.inspection_daily_hours
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT effective_is_manager_admin()));

DROP POLICY IF EXISTS "Managers can update all inspection daily hours" ON public.inspection_daily_hours;
CREATE POLICY "Managers can update all inspection daily hours"
  ON public.inspection_daily_hours
  FOR UPDATE
  TO authenticated
  USING ((SELECT effective_is_manager_admin()))
  WITH CHECK ((SELECT effective_is_manager_admin()));

DROP POLICY IF EXISTS "Managers can manage all inspection photos" ON public.inspection_photos;
CREATE POLICY "Managers can manage all inspection photos"
  ON public.inspection_photos
  FOR ALL
  TO authenticated
  USING ((SELECT effective_is_manager_admin()))
  WITH CHECK ((SELECT effective_is_manager_admin()));

COMMIT;
