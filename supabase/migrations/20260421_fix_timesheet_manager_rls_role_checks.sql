BEGIN;

-- Hotfix: restore effective-role checks for manager/admin timesheet policies.
-- The 20260407 policy optimization reintroduced legacy profiles.role checks here,
-- which blocks manager flows in environments that rely on effective_role_id().

DROP POLICY IF EXISTS "Managers can delete any timesheet entries" ON public.timesheet_entries;
CREATE POLICY "Managers can delete any timesheet entries"
  ON public.timesheet_entries
  FOR DELETE
  TO authenticated
  USING ((SELECT effective_is_manager_admin()));

DROP POLICY IF EXISTS "Managers and admins can delete any timesheet" ON public.timesheets;
CREATE POLICY "Managers and admins can delete any timesheet"
  ON public.timesheets
  FOR DELETE
  TO authenticated
  USING ((SELECT effective_is_manager_admin()));

DROP POLICY IF EXISTS "Managers can create timesheets for any user" ON public.timesheets;
CREATE POLICY "Managers can create timesheets for any user"
  ON public.timesheets
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT effective_is_manager_admin()));

COMMIT;
