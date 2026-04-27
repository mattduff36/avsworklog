BEGIN;

CREATE TABLE IF NOT EXISTS public.timesheet_entry_leave_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  absence_id UUID NOT NULL,
  timesheet_id UUID NOT NULL REFERENCES public.timesheets(id) ON DELETE CASCADE,
  timesheet_entry_id UUID NOT NULL REFERENCES public.timesheet_entries(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  had_entry BOOLEAN NOT NULL DEFAULT true,
  original_entry JSONB,
  original_job_numbers TEXT[] NOT NULL DEFAULT '{}',
  applied_entry JSONB NOT NULL,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT timesheet_entry_leave_snapshots_unique_absence_day
    UNIQUE (absence_id, timesheet_id, day_of_week)
);

CREATE INDEX IF NOT EXISTS idx_timesheet_entry_leave_snapshots_absence
  ON public.timesheet_entry_leave_snapshots(absence_id);

CREATE INDEX IF NOT EXISTS idx_timesheet_entry_leave_snapshots_entry
  ON public.timesheet_entry_leave_snapshots(timesheet_entry_id);

DROP TRIGGER IF EXISTS set_updated_at_timesheet_entry_leave_snapshots
  ON public.timesheet_entry_leave_snapshots;

CREATE TRIGGER set_updated_at_timesheet_entry_leave_snapshots
  BEFORE UPDATE ON public.timesheet_entry_leave_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.timesheet_entry_leave_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Managers can view leave row snapshots"
  ON public.timesheet_entry_leave_snapshots;
CREATE POLICY "Managers can view leave row snapshots"
  ON public.timesheet_entry_leave_snapshots
  FOR SELECT
  TO authenticated
  USING ((SELECT public.effective_is_manager_admin()));

DROP POLICY IF EXISTS "Managers can insert leave row snapshots"
  ON public.timesheet_entry_leave_snapshots;
CREATE POLICY "Managers can insert leave row snapshots"
  ON public.timesheet_entry_leave_snapshots
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT public.effective_is_manager_admin()));

DROP POLICY IF EXISTS "Managers can update leave row snapshots"
  ON public.timesheet_entry_leave_snapshots;
CREATE POLICY "Managers can update leave row snapshots"
  ON public.timesheet_entry_leave_snapshots
  FOR UPDATE
  TO authenticated
  USING ((SELECT public.effective_is_manager_admin()))
  WITH CHECK ((SELECT public.effective_is_manager_admin()));

DROP POLICY IF EXISTS "Managers can delete leave row snapshots"
  ON public.timesheet_entry_leave_snapshots;
CREATE POLICY "Managers can delete leave row snapshots"
  ON public.timesheet_entry_leave_snapshots
  FOR DELETE
  TO authenticated
  USING ((SELECT public.effective_is_manager_admin()));

COMMIT;
