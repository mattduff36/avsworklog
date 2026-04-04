BEGIN;

CREATE OR REPLACE FUNCTION public.effective_is_workshop_team()
RETURNS BOOLEAN AS $$
DECLARE
  eff_team_id UUID;
BEGIN
  eff_team_id := effective_team_id();

  IF eff_team_id IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM org_teams
    WHERE id = eff_team_id
      AND lower(name) = 'workshop'
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

-- Workshop read-all visibility across all daily-check parent tables.
DROP POLICY IF EXISTS "Workshop can view all van inspections" ON van_inspections;
CREATE POLICY "Workshop can view all van inspections" ON van_inspections
  FOR SELECT TO authenticated
  USING (
    effective_is_workshop_team()
    AND effective_has_module_permission('inspections')
  );

DROP POLICY IF EXISTS "Workshop can view all plant inspections" ON plant_inspections;
CREATE POLICY "Workshop can view all plant inspections" ON plant_inspections
  FOR SELECT TO authenticated
  USING (
    effective_is_workshop_team()
    AND effective_has_module_permission('plant-inspections')
  );

DROP POLICY IF EXISTS "Workshop can view all hgv inspections" ON hgv_inspections;
CREATE POLICY "Workshop can view all hgv inspections" ON hgv_inspections
  FOR SELECT TO authenticated
  USING (
    effective_is_workshop_team()
    AND effective_has_module_permission('hgv-inspections')
  );

-- Workshop read-all visibility for child tables.
DROP POLICY IF EXISTS "Workshop can view all inspection items" ON inspection_items;
CREATE POLICY "Workshop can view all inspection items" ON inspection_items
  FOR SELECT TO authenticated
  USING (
    effective_is_workshop_team()
    AND (
      (
        effective_has_module_permission('inspections')
        AND EXISTS (
          SELECT 1
          FROM van_inspections vi
          WHERE vi.id = inspection_items.inspection_id
        )
      )
      OR (
        effective_has_module_permission('plant-inspections')
        AND EXISTS (
          SELECT 1
          FROM plant_inspections pi
          WHERE pi.id = inspection_items.inspection_id
        )
      )
      OR (
        effective_has_module_permission('hgv-inspections')
        AND EXISTS (
          SELECT 1
          FROM hgv_inspections hi
          WHERE hi.id = inspection_items.inspection_id
        )
      )
    )
  );

DROP POLICY IF EXISTS "Workshop can view all inspection daily hours" ON inspection_daily_hours;
CREATE POLICY "Workshop can view all inspection daily hours" ON inspection_daily_hours
  FOR SELECT TO authenticated
  USING (
    effective_is_workshop_team()
    AND (
      (
        effective_has_module_permission('inspections')
        AND EXISTS (
          SELECT 1
          FROM van_inspections vi
          WHERE vi.id = inspection_daily_hours.inspection_id
        )
      )
      OR (
        effective_has_module_permission('plant-inspections')
        AND EXISTS (
          SELECT 1
          FROM plant_inspections pi
          WHERE pi.id = inspection_daily_hours.inspection_id
        )
      )
      OR (
        effective_has_module_permission('hgv-inspections')
        AND EXISTS (
          SELECT 1
          FROM hgv_inspections hi
          WHERE hi.id = inspection_daily_hours.inspection_id
        )
      )
    )
  );

DROP POLICY IF EXISTS "Workshop can view all inspection photos" ON inspection_photos;
CREATE POLICY "Workshop can view all inspection photos" ON inspection_photos
  FOR SELECT TO authenticated
  USING (
    effective_is_workshop_team()
    AND (
      (
        effective_has_module_permission('inspections')
        AND EXISTS (
          SELECT 1
          FROM van_inspections vi
          WHERE vi.id = inspection_photos.inspection_id
        )
      )
      OR (
        effective_has_module_permission('plant-inspections')
        AND EXISTS (
          SELECT 1
          FROM plant_inspections pi
          WHERE pi.id = inspection_photos.inspection_id
        )
      )
      OR (
        effective_has_module_permission('hgv-inspections')
        AND EXISTS (
          SELECT 1
          FROM hgv_inspections hi
          WHERE hi.id = inspection_photos.inspection_id
        )
      )
    )
  );

-- Preserve own-write behavior for Workshop users by excluding workshop team
-- from manager-wide write/delete policies.
DROP POLICY IF EXISTS "Managers can update inspections" ON van_inspections;
CREATE POLICY "Managers can update inspections" ON van_inspections
  FOR UPDATE TO authenticated
  USING (
    effective_is_manager_admin()
    AND NOT effective_is_workshop_team()
    AND status = 'draft'
  )
  WITH CHECK (
    effective_is_manager_admin()
    AND NOT effective_is_workshop_team()
    AND status IN ('draft', 'submitted')
  );

DROP POLICY IF EXISTS "Managers can create plant inspections for users" ON plant_inspections;
CREATE POLICY "Managers can create plant inspections for users" ON plant_inspections
  FOR INSERT TO authenticated
  WITH CHECK (
    effective_is_manager_admin()
    AND NOT effective_is_workshop_team()
  );

DROP POLICY IF EXISTS "Users can update own plant inspections" ON plant_inspections;
CREATE POLICY "Users can update own plant inspections" ON plant_inspections
  FOR UPDATE TO authenticated
  USING (
    (
      user_id = auth.uid()
      OR (
        effective_is_manager_admin()
        AND NOT effective_is_workshop_team()
      )
    )
    AND status = 'draft'
  )
  WITH CHECK (
    (
      user_id = auth.uid()
      OR (
        effective_is_manager_admin()
        AND NOT effective_is_workshop_team()
      )
    )
    AND status IN ('draft', 'submitted')
  );

DROP POLICY IF EXISTS "Managers and admins can delete plant inspections" ON plant_inspections;
DROP POLICY IF EXISTS "Managers can delete draft plant inspections" ON plant_inspections;
CREATE POLICY "Managers can delete draft plant inspections" ON plant_inspections
  FOR DELETE TO authenticated
  USING (
    effective_is_manager_admin()
    AND NOT effective_is_workshop_team()
    AND status = 'draft'
  );

DROP POLICY IF EXISTS "Users can update own hgv inspections" ON hgv_inspections;
CREATE POLICY "Users can update own hgv inspections" ON hgv_inspections
  FOR UPDATE TO authenticated
  USING (
    (
      user_id = auth.uid()
      OR (
        effective_is_manager_admin()
        AND NOT effective_is_workshop_team()
      )
    )
    AND status = 'draft'
  )
  WITH CHECK (
    (
      user_id = auth.uid()
      OR (
        effective_is_manager_admin()
        AND NOT effective_is_workshop_team()
      )
    )
    AND status IN ('draft', 'submitted')
  );

DROP POLICY IF EXISTS "Managers can delete draft hgv inspections" ON hgv_inspections;
CREATE POLICY "Managers can delete draft hgv inspections" ON hgv_inspections
  FOR DELETE TO authenticated
  USING (
    effective_is_manager_admin()
    AND NOT effective_is_workshop_team()
    AND status = 'draft'
  );

DROP POLICY IF EXISTS "Managers can manage all items" ON inspection_items;
CREATE POLICY "Managers can manage all items" ON inspection_items
  FOR ALL TO authenticated
  USING (
    effective_is_manager_admin()
    AND NOT effective_is_workshop_team()
  )
  WITH CHECK (
    effective_is_manager_admin()
    AND NOT effective_is_workshop_team()
  );

DROP POLICY IF EXISTS "Managers can insert all inspection daily hours" ON inspection_daily_hours;
CREATE POLICY "Managers can insert all inspection daily hours" ON inspection_daily_hours
  FOR INSERT TO authenticated
  WITH CHECK (
    effective_is_manager_admin()
    AND NOT effective_is_workshop_team()
  );

DROP POLICY IF EXISTS "Managers can update all inspection daily hours" ON inspection_daily_hours;
CREATE POLICY "Managers can update all inspection daily hours" ON inspection_daily_hours
  FOR UPDATE TO authenticated
  USING (
    effective_is_manager_admin()
    AND NOT effective_is_workshop_team()
  )
  WITH CHECK (
    effective_is_manager_admin()
    AND NOT effective_is_workshop_team()
  );

DROP POLICY IF EXISTS "Managers can delete all inspection daily hours" ON inspection_daily_hours;
CREATE POLICY "Managers can delete all inspection daily hours" ON inspection_daily_hours
  FOR DELETE TO authenticated
  USING (
    effective_is_manager_admin()
    AND NOT effective_is_workshop_team()
  );

DROP POLICY IF EXISTS "Managers can manage all inspection photos" ON inspection_photos;
DROP POLICY IF EXISTS "Managers can view all inspection photos" ON inspection_photos;
CREATE POLICY "Managers can manage all inspection photos" ON inspection_photos
  FOR ALL TO authenticated
  USING (
    effective_is_manager_admin()
    AND NOT effective_is_workshop_team()
  )
  WITH CHECK (
    effective_is_manager_admin()
    AND NOT effective_is_workshop_team()
  );

COMMIT;
