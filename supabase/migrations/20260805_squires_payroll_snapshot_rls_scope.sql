-- Tighten payroll snapshot RLS so managers cannot bypass report/team scope via
-- direct PostgREST reads. Elevated reads use service-role APIs that apply
-- filterTimesheetRowsForReportScope.

DROP POLICY IF EXISTS "Payroll snapshots scoped read" ON public.timesheet_payroll_snapshots;
CREATE POLICY "Payroll snapshots scoped read" ON public.timesheet_payroll_snapshots
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.timesheets timesheet
      WHERE timesheet.id = timesheet_id
        AND (
          timesheet.user_id = (SELECT auth.uid())
          OR (SELECT public.payroll_is_full_admin())
        )
    )
  );

DROP POLICY IF EXISTS "Payroll snapshot days scoped read" ON public.timesheet_payroll_snapshot_days;
CREATE POLICY "Payroll snapshot days scoped read" ON public.timesheet_payroll_snapshot_days
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.timesheet_payroll_snapshots snapshot
      JOIN public.timesheets timesheet ON timesheet.id = snapshot.timesheet_id
      WHERE snapshot.id = snapshot_id
        AND (
          timesheet.user_id = (SELECT auth.uid())
          OR (SELECT public.payroll_is_full_admin())
        )
    )
  );
