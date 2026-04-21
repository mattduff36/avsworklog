-- Add structured child rows for multiple timesheet job codes per day while
-- keeping the legacy timesheet_entries.job_number column for compatibility.

CREATE TABLE IF NOT EXISTS public.timesheet_entry_job_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timesheet_entry_id UUID NOT NULL REFERENCES public.timesheet_entries(id) ON DELETE CASCADE,
  job_number TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT timesheet_entry_job_codes_display_order_check CHECK (display_order >= 0),
  CONSTRAINT timesheet_entry_job_codes_unique_entry_job UNIQUE (timesheet_entry_id, job_number)
);

CREATE INDEX IF NOT EXISTS idx_timesheet_entry_job_codes_entry_order
  ON public.timesheet_entry_job_codes(timesheet_entry_id, display_order);

DROP TRIGGER IF EXISTS set_updated_at_timesheet_entry_job_codes ON public.timesheet_entry_job_codes;
CREATE TRIGGER set_updated_at_timesheet_entry_job_codes
  BEFORE UPDATE ON public.timesheet_entry_job_codes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.timesheet_entry_job_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Managers can delete any timesheet entry job codes" ON public.timesheet_entry_job_codes;
CREATE POLICY "Managers can delete any timesheet entry job codes"
  ON public.timesheet_entry_job_codes
  FOR DELETE
  TO authenticated
  USING ((SELECT effective_is_manager_admin()));

DROP POLICY IF EXISTS "Managers can insert any timesheet entry job codes" ON public.timesheet_entry_job_codes;
CREATE POLICY "Managers can insert any timesheet entry job codes"
  ON public.timesheet_entry_job_codes
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT effective_is_manager_admin()));

DROP POLICY IF EXISTS "Managers can update any timesheet entry job codes" ON public.timesheet_entry_job_codes;
CREATE POLICY "Managers can update any timesheet entry job codes"
  ON public.timesheet_entry_job_codes
  FOR UPDATE
  TO authenticated
  USING ((SELECT effective_is_manager_admin()))
  WITH CHECK ((SELECT effective_is_manager_admin()));

DROP POLICY IF EXISTS "Managers can view all timesheet entry job codes" ON public.timesheet_entry_job_codes;
CREATE POLICY "Managers can view all timesheet entry job codes"
  ON public.timesheet_entry_job_codes
  FOR SELECT
  TO authenticated
  USING ((SELECT effective_is_manager_admin()));

DROP POLICY IF EXISTS "Users can delete own timesheet entry job codes" ON public.timesheet_entry_job_codes;
CREATE POLICY "Users can delete own timesheet entry job codes"
  ON public.timesheet_entry_job_codes
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.timesheet_entries
      JOIN public.timesheets ON public.timesheets.id = public.timesheet_entries.timesheet_id
      WHERE public.timesheet_entries.id = public.timesheet_entry_job_codes.timesheet_entry_id
        AND public.timesheets.user_id = (SELECT auth.uid())
        AND public.timesheets.status = ANY (ARRAY['draft'::text, 'rejected'::text, 'submitted'::text])
    )
  );

DROP POLICY IF EXISTS "Users can insert own timesheet entry job codes" ON public.timesheet_entry_job_codes;
CREATE POLICY "Users can insert own timesheet entry job codes"
  ON public.timesheet_entry_job_codes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.timesheet_entries
      JOIN public.timesheets ON public.timesheets.id = public.timesheet_entries.timesheet_id
      WHERE public.timesheet_entries.id = public.timesheet_entry_job_codes.timesheet_entry_id
        AND public.timesheets.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can update own timesheet entry job codes" ON public.timesheet_entry_job_codes;
CREATE POLICY "Users can update own timesheet entry job codes"
  ON public.timesheet_entry_job_codes
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.timesheet_entries
      JOIN public.timesheets ON public.timesheets.id = public.timesheet_entries.timesheet_id
      WHERE public.timesheet_entries.id = public.timesheet_entry_job_codes.timesheet_entry_id
        AND public.timesheets.user_id = (SELECT auth.uid())
        AND public.timesheets.status = ANY (ARRAY['draft'::text, 'rejected'::text])
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.timesheet_entries
      JOIN public.timesheets ON public.timesheets.id = public.timesheet_entries.timesheet_id
      WHERE public.timesheet_entries.id = public.timesheet_entry_job_codes.timesheet_entry_id
        AND public.timesheets.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can view own timesheet entry job codes" ON public.timesheet_entry_job_codes;
CREATE POLICY "Users can view own timesheet entry job codes"
  ON public.timesheet_entry_job_codes
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.timesheet_entries
      JOIN public.timesheets ON public.timesheets.id = public.timesheet_entries.timesheet_id
      WHERE public.timesheet_entries.id = public.timesheet_entry_job_codes.timesheet_entry_id
        AND public.timesheets.user_id = (SELECT auth.uid())
    )
  );

INSERT INTO public.timesheet_entry_job_codes (timesheet_entry_id, job_number, display_order)
SELECT entry.id, entry.job_number, 0
FROM public.timesheet_entries AS entry
WHERE NULLIF(BTRIM(entry.job_number), '') IS NOT NULL
ON CONFLICT (timesheet_entry_id, job_number) DO NOTHING;
