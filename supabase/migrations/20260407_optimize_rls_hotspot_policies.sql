BEGIN;

-- ============================================================================
-- Supabase Advisor remediation: optimize hotspot RLS policies
-- ============================================================================
-- Focus areas:
--   - actions
--   - absences
--   - van_inspections / plant_inspections / hgv_inspections
--   - inspection_items / inspection_daily_hours
--   - messages
--
-- Strategy:
--   - wrap auth identity lookups as (SELECT auth.uid())
--   - wrap row-independent helper predicates as SELECT subqueries so Postgres
--     can evaluate them once per statement instead of once per row
-- ============================================================================

-- ---- absences ---------------------------------------------------------------
DROP POLICY IF EXISTS "Absence editors can create scoped absences" ON public.absences;
CREATE POLICY "Absence editors can create scoped absences"
  ON public.absences
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT is_actor_absence_secondary_editor((SELECT auth.uid())))
    AND can_actor_edit_absence_request((SELECT auth.uid()), profile_id)
  );

DROP POLICY IF EXISTS "Absence editors can delete scoped absences" ON public.absences;
CREATE POLICY "Absence editors can delete scoped absences"
  ON public.absences
  FOR DELETE
  TO authenticated
  USING (
    (SELECT is_actor_absence_secondary_editor((SELECT auth.uid())))
    AND can_actor_edit_absence_request((SELECT auth.uid()), profile_id)
  );

DROP POLICY IF EXISTS "Absence editors can update scoped absences" ON public.absences;
CREATE POLICY "Absence editors can update scoped absences"
  ON public.absences
  FOR UPDATE
  TO authenticated
  USING (
    (SELECT is_actor_absence_secondary_editor((SELECT auth.uid())))
    AND (
      can_actor_edit_absence_request((SELECT auth.uid()), profile_id)
      OR can_actor_approve_absence_request((SELECT auth.uid()), profile_id)
    )
  )
  WITH CHECK (
    (SELECT is_actor_absence_secondary_editor((SELECT auth.uid())))
    AND (
      can_actor_edit_absence_request((SELECT auth.uid()), profile_id)
      OR can_actor_approve_absence_request((SELECT auth.uid()), profile_id)
    )
  );

DROP POLICY IF EXISTS "Absence viewers can read scoped absences" ON public.absences;
CREATE POLICY "Absence viewers can read scoped absences"
  ON public.absences
  FOR SELECT
  TO authenticated
  USING (can_actor_access_absence_request((SELECT auth.uid()), profile_id));

DROP POLICY IF EXISTS "Users can create own absences" ON public.absences;
CREATE POLICY "Users can create own absences"
  ON public.absences
  FOR INSERT
  TO authenticated
  WITH CHECK (
    ((SELECT auth.uid()) = profile_id)
    AND ((SELECT auth.uid()) = created_by)
    AND (NOT is_absence_financial_year_closed(absence_financial_year_start_year(date)))
    AND EXISTS (
      SELECT 1
      FROM public.absence_reasons ar
      WHERE ar.id = public.absences.reason_id
        AND ar.is_active = TRUE
        AND lower(ar.name) = ANY (ARRAY['annual leave', 'unpaid leave'])
    )
  );

-- ---- actions ----------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can create actions" ON public.actions;
CREATE POLICY "Authenticated users can create actions"
  ON public.actions
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "Managers can create actions" ON public.actions;
CREATE POLICY "Managers can create actions"
  ON public.actions
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT effective_is_manager_admin()));

DROP POLICY IF EXISTS "Managers can delete actions" ON public.actions;
CREATE POLICY "Managers can delete actions"
  ON public.actions
  FOR DELETE
  TO authenticated
  USING ((SELECT effective_is_manager_admin()));

DROP POLICY IF EXISTS "Managers can update actions" ON public.actions;
CREATE POLICY "Managers can update actions"
  ON public.actions
  FOR UPDATE
  TO authenticated
  USING ((SELECT effective_is_manager_admin()));

DROP POLICY IF EXISTS "Managers can view all actions" ON public.actions;
CREATE POLICY "Managers can view all actions"
  ON public.actions
  FOR SELECT
  TO authenticated
  USING ((SELECT effective_is_manager_admin()));

DROP POLICY IF EXISTS "Workshop users can create workshop tasks" ON public.actions;
CREATE POLICY "Workshop users can create workshop tasks"
  ON public.actions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    action_type = ANY (ARRAY['inspection_defect', 'workshop_vehicle_task'])
    AND (SELECT effective_has_module_permission('workshop-tasks'))
  );

DROP POLICY IF EXISTS "Workshop users can update workshop tasks" ON public.actions;
CREATE POLICY "Workshop users can update workshop tasks"
  ON public.actions
  FOR UPDATE
  TO authenticated
  USING (
    action_type = ANY (ARRAY['inspection_defect', 'workshop_vehicle_task'])
    AND (SELECT effective_has_module_permission('workshop-tasks'))
  )
  WITH CHECK (
    action_type = ANY (ARRAY['inspection_defect', 'workshop_vehicle_task'])
    AND (SELECT effective_has_module_permission('workshop-tasks'))
  );

DROP POLICY IF EXISTS "Workshop users can view workshop tasks" ON public.actions;
CREATE POLICY "Workshop users can view workshop tasks"
  ON public.actions
  FOR SELECT
  TO authenticated
  USING (
    action_type = ANY (ARRAY['inspection_defect', 'workshop_vehicle_task'])
    AND (SELECT effective_has_module_permission('workshop-tasks'))
  );

-- ---- van_inspections --------------------------------------------------------
DROP POLICY IF EXISTS "Employees can create own inspections" ON public.van_inspections;
CREATE POLICY "Employees can create own inspections"
  ON public.van_inspections
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Employees can update own inspections" ON public.van_inspections;
CREATE POLICY "Employees can update own inspections"
  ON public.van_inspections
  FOR UPDATE
  TO authenticated
  USING (((SELECT auth.uid()) = user_id) AND status = 'draft')
  WITH CHECK (((SELECT auth.uid()) = user_id) AND status IN ('draft', 'submitted'));

DROP POLICY IF EXISTS "Managers and admins can delete any inspection" ON public.van_inspections;
CREATE POLICY "Managers and admins can delete any inspection"
  ON public.van_inspections
  FOR DELETE
  TO authenticated
  USING ((SELECT effective_is_manager_admin()));

DROP POLICY IF EXISTS "Managers can create inspections for users" ON public.van_inspections;
CREATE POLICY "Managers can create inspections for users"
  ON public.van_inspections
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT effective_is_manager_admin()));

DROP POLICY IF EXISTS "Managers can update inspections" ON public.van_inspections;
CREATE POLICY "Managers can update inspections"
  ON public.van_inspections
  FOR UPDATE
  TO authenticated
  USING (
    (SELECT effective_is_manager_admin())
    AND NOT (SELECT effective_is_workshop_team())
    AND status = 'draft'
  )
  WITH CHECK (
    (SELECT effective_is_manager_admin())
    AND NOT (SELECT effective_is_workshop_team())
    AND status IN ('draft', 'submitted')
  );

DROP POLICY IF EXISTS "Managers can view all inspections" ON public.van_inspections;
CREATE POLICY "Managers can view all inspections"
  ON public.van_inspections
  FOR SELECT
  TO authenticated
  USING ((SELECT effective_is_manager_admin()));

DROP POLICY IF EXISTS "Supervisors can view all van inspections" ON public.van_inspections;
CREATE POLICY "Supervisors can view all van inspections"
  ON public.van_inspections
  FOR SELECT
  TO authenticated
  USING (
    (SELECT effective_is_supervisor())
    AND (SELECT effective_has_module_permission('inspections'))
  );

DROP POLICY IF EXISTS "Workshop can view all van inspections" ON public.van_inspections;
CREATE POLICY "Workshop can view all van inspections"
  ON public.van_inspections
  FOR SELECT
  TO authenticated
  USING (
    (SELECT effective_is_workshop_team())
    AND (SELECT effective_has_module_permission('inspections'))
  );

-- ---- plant_inspections ------------------------------------------------------
DROP POLICY IF EXISTS "Employees can create own plant inspections" ON public.plant_inspections;
CREATE POLICY "Employees can create own plant inspections"
  ON public.plant_inspections
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Employees can view own plant inspections" ON public.plant_inspections;
CREATE POLICY "Employees can view own plant inspections"
  ON public.plant_inspections
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Managers can create plant inspections for users" ON public.plant_inspections;
CREATE POLICY "Managers can create plant inspections for users"
  ON public.plant_inspections
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT effective_is_manager_admin())
    AND NOT (SELECT effective_is_workshop_team())
  );

DROP POLICY IF EXISTS "Managers can delete draft plant inspections" ON public.plant_inspections;
CREATE POLICY "Managers can delete draft plant inspections"
  ON public.plant_inspections
  FOR DELETE
  TO authenticated
  USING (
    (SELECT effective_is_manager_admin())
    AND NOT (SELECT effective_is_workshop_team())
    AND status = 'draft'
  );

DROP POLICY IF EXISTS "Managers can view all plant inspections" ON public.plant_inspections;
CREATE POLICY "Managers can view all plant inspections"
  ON public.plant_inspections
  FOR SELECT
  TO authenticated
  USING ((SELECT effective_is_manager_admin()));

DROP POLICY IF EXISTS "Supervisors can view all plant inspections" ON public.plant_inspections;
CREATE POLICY "Supervisors can view all plant inspections"
  ON public.plant_inspections
  FOR SELECT
  TO authenticated
  USING (
    (SELECT effective_is_supervisor())
    AND (SELECT effective_has_module_permission('plant-inspections'))
  );

DROP POLICY IF EXISTS "Users can delete own draft plant inspections" ON public.plant_inspections;
CREATE POLICY "Users can delete own draft plant inspections"
  ON public.plant_inspections
  FOR DELETE
  TO authenticated
  USING ((user_id = (SELECT auth.uid())) AND status = 'draft');

DROP POLICY IF EXISTS "Users can update own plant inspections" ON public.plant_inspections;
CREATE POLICY "Users can update own plant inspections"
  ON public.plant_inspections
  FOR UPDATE
  TO authenticated
  USING (
    (
      user_id = (SELECT auth.uid())
      OR (
        (SELECT effective_is_manager_admin())
        AND NOT (SELECT effective_is_workshop_team())
      )
    )
    AND status = 'draft'
  )
  WITH CHECK (
    (
      user_id = (SELECT auth.uid())
      OR (
        (SELECT effective_is_manager_admin())
        AND NOT (SELECT effective_is_workshop_team())
      )
    )
    AND status IN ('draft', 'submitted')
  );

DROP POLICY IF EXISTS "Workshop can view all plant inspections" ON public.plant_inspections;
CREATE POLICY "Workshop can view all plant inspections"
  ON public.plant_inspections
  FOR SELECT
  TO authenticated
  USING (
    (SELECT effective_is_workshop_team())
    AND (SELECT effective_has_module_permission('plant-inspections'))
  );

-- ---- hgv_inspections --------------------------------------------------------
DROP POLICY IF EXISTS "Admins can delete hgv inspections" ON public.hgv_inspections;
CREATE POLICY "Admins can delete hgv inspections"
  ON public.hgv_inspections
  FOR DELETE
  TO authenticated
  USING ((SELECT effective_has_role_name('admin')));

DROP POLICY IF EXISTS "Managers can delete draft hgv inspections" ON public.hgv_inspections;
CREATE POLICY "Managers can delete draft hgv inspections"
  ON public.hgv_inspections
  FOR DELETE
  TO authenticated
  USING (
    (SELECT effective_is_manager_admin())
    AND NOT (SELECT effective_is_workshop_team())
    AND status = 'draft'
  );

DROP POLICY IF EXISTS "Supervisors can view all hgv inspections" ON public.hgv_inspections;
CREATE POLICY "Supervisors can view all hgv inspections"
  ON public.hgv_inspections
  FOR SELECT
  TO authenticated
  USING (
    (SELECT effective_is_supervisor())
    AND (SELECT effective_has_module_permission('hgv-inspections'))
  );

DROP POLICY IF EXISTS "Users can create hgv inspections" ON public.hgv_inspections;
CREATE POLICY "Users can create hgv inspections"
  ON public.hgv_inspections
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "Users can delete own draft hgv inspections" ON public.hgv_inspections;
CREATE POLICY "Users can delete own draft hgv inspections"
  ON public.hgv_inspections
  FOR DELETE
  TO authenticated
  USING ((user_id = (SELECT auth.uid())) AND status = 'draft');

DROP POLICY IF EXISTS "Users can update own hgv inspections" ON public.hgv_inspections;
CREATE POLICY "Users can update own hgv inspections"
  ON public.hgv_inspections
  FOR UPDATE
  TO authenticated
  USING (
    (
      user_id = (SELECT auth.uid())
      OR (
        (SELECT effective_is_manager_admin())
        AND NOT (SELECT effective_is_workshop_team())
      )
    )
    AND status = 'draft'
  )
  WITH CHECK (
    (
      user_id = (SELECT auth.uid())
      OR (
        (SELECT effective_is_manager_admin())
        AND NOT (SELECT effective_is_workshop_team())
      )
    )
    AND status IN ('draft', 'submitted')
  );

DROP POLICY IF EXISTS "Users can view own hgv inspections" ON public.hgv_inspections;
CREATE POLICY "Users can view own hgv inspections"
  ON public.hgv_inspections
  FOR SELECT
  TO authenticated
  USING (
    (user_id = (SELECT auth.uid()))
    OR (SELECT effective_is_manager_admin())
  );

DROP POLICY IF EXISTS "Workshop can view all hgv inspections" ON public.hgv_inspections;
CREATE POLICY "Workshop can view all hgv inspections"
  ON public.hgv_inspections
  FOR SELECT
  TO authenticated
  USING (
    (SELECT effective_is_workshop_team())
    AND (SELECT effective_has_module_permission('hgv-inspections'))
  );

-- ---- inspection_daily_hours -------------------------------------------------
DROP POLICY IF EXISTS "Employees can delete own inspection daily hours" ON public.inspection_daily_hours;
CREATE POLICY "Employees can delete own inspection daily hours"
  ON public.inspection_daily_hours
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.van_inspections vi
      WHERE vi.id = public.inspection_daily_hours.inspection_id
        AND vi.user_id = (SELECT auth.uid())
        AND vi.status = 'draft'
    )
    OR EXISTS (
      SELECT 1
      FROM public.plant_inspections pi
      WHERE pi.id = public.inspection_daily_hours.inspection_id
        AND pi.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1
      FROM public.hgv_inspections hi
      WHERE hi.id = public.inspection_daily_hours.inspection_id
        AND hi.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Employees can insert own inspection daily hours" ON public.inspection_daily_hours;
CREATE POLICY "Employees can insert own inspection daily hours"
  ON public.inspection_daily_hours
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.van_inspections vi
      WHERE vi.id = public.inspection_daily_hours.inspection_id
        AND vi.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1
      FROM public.plant_inspections pi
      WHERE pi.id = public.inspection_daily_hours.inspection_id
        AND pi.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1
      FROM public.hgv_inspections hi
      WHERE hi.id = public.inspection_daily_hours.inspection_id
        AND hi.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Employees can update own inspection daily hours" ON public.inspection_daily_hours;
CREATE POLICY "Employees can update own inspection daily hours"
  ON public.inspection_daily_hours
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.van_inspections vi
      WHERE vi.id = public.inspection_daily_hours.inspection_id
        AND vi.user_id = (SELECT auth.uid())
        AND vi.status = 'draft'
    )
    OR EXISTS (
      SELECT 1
      FROM public.plant_inspections pi
      WHERE pi.id = public.inspection_daily_hours.inspection_id
        AND pi.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1
      FROM public.hgv_inspections hi
      WHERE hi.id = public.inspection_daily_hours.inspection_id
        AND hi.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Employees can view own inspection daily hours" ON public.inspection_daily_hours;
CREATE POLICY "Employees can view own inspection daily hours"
  ON public.inspection_daily_hours
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.van_inspections vi
      WHERE vi.id = public.inspection_daily_hours.inspection_id
        AND vi.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1
      FROM public.plant_inspections pi
      WHERE pi.id = public.inspection_daily_hours.inspection_id
        AND pi.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1
      FROM public.hgv_inspections hi
      WHERE hi.id = public.inspection_daily_hours.inspection_id
        AND hi.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Managers can delete all inspection daily hours" ON public.inspection_daily_hours;
CREATE POLICY "Managers can delete all inspection daily hours"
  ON public.inspection_daily_hours
  FOR DELETE
  TO authenticated
  USING (
    (SELECT effective_is_manager_admin())
    AND NOT (SELECT effective_is_workshop_team())
  );

DROP POLICY IF EXISTS "Managers can insert all inspection daily hours" ON public.inspection_daily_hours;
CREATE POLICY "Managers can insert all inspection daily hours"
  ON public.inspection_daily_hours
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT effective_is_manager_admin())
    AND NOT (SELECT effective_is_workshop_team())
  );

DROP POLICY IF EXISTS "Managers can update all inspection daily hours" ON public.inspection_daily_hours;
CREATE POLICY "Managers can update all inspection daily hours"
  ON public.inspection_daily_hours
  FOR UPDATE
  TO authenticated
  USING (
    (SELECT effective_is_manager_admin())
    AND NOT (SELECT effective_is_workshop_team())
  )
  WITH CHECK (
    (SELECT effective_is_manager_admin())
    AND NOT (SELECT effective_is_workshop_team())
  );

DROP POLICY IF EXISTS "Managers can view all inspection daily hours" ON public.inspection_daily_hours;
CREATE POLICY "Managers can view all inspection daily hours"
  ON public.inspection_daily_hours
  FOR SELECT
  TO authenticated
  USING ((SELECT effective_is_manager_admin()));

DROP POLICY IF EXISTS "Supervisors can view all inspection daily hours" ON public.inspection_daily_hours;
CREATE POLICY "Supervisors can view all inspection daily hours"
  ON public.inspection_daily_hours
  FOR SELECT
  TO authenticated
  USING (
    (SELECT effective_is_supervisor())
    AND (
      (SELECT effective_has_module_permission('inspections'))
      OR (SELECT effective_has_module_permission('plant-inspections'))
      OR (SELECT effective_has_module_permission('hgv-inspections'))
    )
  );

DROP POLICY IF EXISTS "Workshop can view all inspection daily hours" ON public.inspection_daily_hours;
CREATE POLICY "Workshop can view all inspection daily hours"
  ON public.inspection_daily_hours
  FOR SELECT
  TO authenticated
  USING (
    (SELECT effective_is_workshop_team())
    AND (
      (
        (SELECT effective_has_module_permission('inspections'))
        AND EXISTS (
          SELECT 1
          FROM public.van_inspections vi
          WHERE vi.id = public.inspection_daily_hours.inspection_id
        )
      )
      OR (
        (SELECT effective_has_module_permission('plant-inspections'))
        AND EXISTS (
          SELECT 1
          FROM public.plant_inspections pi
          WHERE pi.id = public.inspection_daily_hours.inspection_id
        )
      )
      OR (
        (SELECT effective_has_module_permission('hgv-inspections'))
        AND EXISTS (
          SELECT 1
          FROM public.hgv_inspections hi
          WHERE hi.id = public.inspection_daily_hours.inspection_id
        )
      )
    )
  );

-- ---- inspection_items -------------------------------------------------------
DROP POLICY IF EXISTS "Employees can delete own inspection items" ON public.inspection_items;
CREATE POLICY "Employees can delete own inspection items"
  ON public.inspection_items
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.van_inspections vi
      WHERE vi.id = public.inspection_items.inspection_id
        AND vi.user_id = (SELECT auth.uid())
        AND vi.status = 'draft'
    )
    OR EXISTS (
      SELECT 1
      FROM public.plant_inspections pi
      WHERE pi.id = public.inspection_items.inspection_id
        AND pi.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1
      FROM public.hgv_inspections hi
      WHERE hi.id = public.inspection_items.inspection_id
        AND hi.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Employees can insert own inspection items" ON public.inspection_items;
CREATE POLICY "Employees can insert own inspection items"
  ON public.inspection_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.van_inspections vi
      WHERE vi.id = public.inspection_items.inspection_id
        AND vi.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1
      FROM public.plant_inspections pi
      WHERE pi.id = public.inspection_items.inspection_id
        AND pi.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1
      FROM public.hgv_inspections hi
      WHERE hi.id = public.inspection_items.inspection_id
        AND hi.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Employees can update own inspection items" ON public.inspection_items;
CREATE POLICY "Employees can update own inspection items"
  ON public.inspection_items
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.van_inspections vi
      WHERE vi.id = public.inspection_items.inspection_id
        AND vi.user_id = (SELECT auth.uid())
        AND vi.status = 'draft'
    )
    OR EXISTS (
      SELECT 1
      FROM public.plant_inspections pi
      WHERE pi.id = public.inspection_items.inspection_id
        AND pi.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1
      FROM public.hgv_inspections hi
      WHERE hi.id = public.inspection_items.inspection_id
        AND hi.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Employees can view own inspection items" ON public.inspection_items;
CREATE POLICY "Employees can view own inspection items"
  ON public.inspection_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.van_inspections vi
      WHERE vi.id = public.inspection_items.inspection_id
        AND vi.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1
      FROM public.plant_inspections pi
      WHERE pi.id = public.inspection_items.inspection_id
        AND pi.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1
      FROM public.hgv_inspections hi
      WHERE hi.id = public.inspection_items.inspection_id
        AND hi.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Managers can manage all items" ON public.inspection_items;
CREATE POLICY "Managers can manage all items"
  ON public.inspection_items
  FOR ALL
  TO authenticated
  USING (
    (SELECT effective_is_manager_admin())
    AND NOT (SELECT effective_is_workshop_team())
  )
  WITH CHECK (
    (SELECT effective_is_manager_admin())
    AND NOT (SELECT effective_is_workshop_team())
  );

DROP POLICY IF EXISTS "Managers can view all inspection items" ON public.inspection_items;
CREATE POLICY "Managers can view all inspection items"
  ON public.inspection_items
  FOR SELECT
  TO authenticated
  USING ((SELECT effective_is_manager_admin()));

DROP POLICY IF EXISTS "Supervisors can view all inspection items" ON public.inspection_items;
CREATE POLICY "Supervisors can view all inspection items"
  ON public.inspection_items
  FOR SELECT
  TO authenticated
  USING (
    (SELECT effective_is_supervisor())
    AND (
      (SELECT effective_has_module_permission('inspections'))
      OR (SELECT effective_has_module_permission('plant-inspections'))
      OR (SELECT effective_has_module_permission('hgv-inspections'))
    )
  );

DROP POLICY IF EXISTS "Workshop can view all inspection items" ON public.inspection_items;
CREATE POLICY "Workshop can view all inspection items"
  ON public.inspection_items
  FOR SELECT
  TO authenticated
  USING (
    (SELECT effective_is_workshop_team())
    AND (
      (
        (SELECT effective_has_module_permission('inspections'))
        AND EXISTS (
          SELECT 1
          FROM public.van_inspections vi
          WHERE vi.id = public.inspection_items.inspection_id
        )
      )
      OR (
        (SELECT effective_has_module_permission('plant-inspections'))
        AND EXISTS (
          SELECT 1
          FROM public.plant_inspections pi
          WHERE pi.id = public.inspection_items.inspection_id
        )
      )
      OR (
        (SELECT effective_has_module_permission('hgv-inspections'))
        AND EXISTS (
          SELECT 1
          FROM public.hgv_inspections hi
          WHERE hi.id = public.inspection_items.inspection_id
        )
      )
    )
  );

-- ---- messages ---------------------------------------------------------------
DROP POLICY IF EXISTS "Managers can create messages" ON public.messages;
CREATE POLICY "Managers can create messages"
  ON public.messages
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT effective_is_manager_admin()));

DROP POLICY IF EXISTS "Managers can delete messages" ON public.messages;
CREATE POLICY "Managers can delete messages"
  ON public.messages
  FOR DELETE
  TO authenticated
  USING ((SELECT effective_is_manager_admin()));

DROP POLICY IF EXISTS "Managers can update messages" ON public.messages;
CREATE POLICY "Managers can update messages"
  ON public.messages
  FOR UPDATE
  TO authenticated
  USING ((SELECT effective_is_manager_admin()));

DROP POLICY IF EXISTS "Managers can view all messages" ON public.messages;
CREATE POLICY "Managers can view all messages"
  ON public.messages
  FOR SELECT
  TO authenticated
  USING ((SELECT effective_is_manager_admin()));

-- ---- verification -----------------------------------------------------------
DO $$
DECLARE
  touched_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO touched_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND policyname = ANY (ARRAY[
      'Absence editors can create scoped absences',
      'Managers can view all actions',
      'Managers can view all inspections',
      'Managers can view all plant inspections',
      'Users can view own hgv inspections',
      'Managers can view all inspection daily hours',
      'Managers can view all inspection items',
      'Managers can view all messages'
    ]);

  IF touched_count <> 8 THEN
    RAISE EXCEPTION 'Expected 8 anchor policies to exist after hotspot remediation, found %', touched_count;
  END IF;
END $$;

COMMIT;
