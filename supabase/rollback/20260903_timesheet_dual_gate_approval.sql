-- finalise-phase: predeploy
-- Recovery for 20260903_timesheet_dual_gate_approval.sql.
-- Do not drop timesheet_payroll_edits if any rows exist.
-- Restores the 20260805 approved-only entry/job-code lock functions and the
-- pre-change owner UPDATE policy. Authoriser draft/rejected policies are kept.

BEGIN;

DROP POLICY IF EXISTS "Timesheet authorisers can view payroll edits" ON public.timesheet_payroll_edits;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'timesheet_payroll_edits'
  ) AND EXISTS (
    SELECT 1 FROM public.timesheet_payroll_edits
  ) THEN
    RAISE EXCEPTION 'timesheet_payroll_edits has rows; do not drop payroll-edit audit history';
  END IF;
END $$;

DROP TABLE IF EXISTS public.timesheet_payroll_edits;

ALTER TABLE public.timesheets
  DROP CONSTRAINT IF EXISTS timesheets_status_gate_check;

UPDATE public.timesheets
SET status = 'submitted'
WHERE status = 'manager_approved';

ALTER TABLE public.timesheets
  DROP CONSTRAINT IF EXISTS timesheets_status_check;

ALTER TABLE public.timesheets
  ADD CONSTRAINT timesheets_status_check
  CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'processed', 'adjusted'));

ALTER TABLE public.timesheets
  DROP COLUMN IF EXISTS payroll_received_at,
  DROP COLUMN IF EXISTS payroll_received_by,
  DROP COLUMN IF EXISTS manager_approved_at,
  DROP COLUMN IF EXISTS manager_approved_by;

DROP POLICY IF EXISTS "Users can update own timesheets" ON public.timesheets;
CREATE POLICY "Users can update own timesheets"
  ON public.timesheets
  FOR UPDATE
  TO authenticated
  USING (
    (user_id = (SELECT auth.uid()))
    AND (status = ANY (ARRAY['draft'::text, 'rejected'::text]))
  )
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.reject_approved_timesheet_entry_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  parent_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT status INTO parent_status
    FROM public.timesheets
    WHERE id = NEW.timesheet_id
    FOR SHARE;
    IF parent_status = 'approved' THEN
      RAISE EXCEPTION 'Approved timesheet entries are immutable; mark the timesheet as adjusted before changing entries';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    SELECT status INTO parent_status
    FROM public.timesheets
    WHERE id = OLD.timesheet_id
    FOR SHARE;
    IF parent_status = 'approved' THEN
      RAISE EXCEPTION 'Approved timesheet entries are immutable; mark the timesheet as adjusted before changing entries';
    END IF;
    RETURN OLD;
  END IF;

  SELECT status INTO parent_status
  FROM public.timesheets
  WHERE id = OLD.timesheet_id
  FOR SHARE;
  IF parent_status = 'approved' THEN
    RAISE EXCEPTION 'Approved timesheet entries are immutable; mark the timesheet as adjusted before changing entries';
  END IF;

  IF NEW.timesheet_id IS DISTINCT FROM OLD.timesheet_id THEN
    SELECT status INTO parent_status
    FROM public.timesheets
    WHERE id = NEW.timesheet_id
    FOR SHARE;
    IF parent_status = 'approved' THEN
      RAISE EXCEPTION 'Approved timesheet entries are immutable; mark the timesheet as adjusted before changing entries';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_approved_timesheet_entry_job_code_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  parent_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT timesheet.status INTO parent_status
    FROM public.timesheet_entries entry
    JOIN public.timesheets timesheet ON timesheet.id = entry.timesheet_id
    WHERE entry.id = NEW.timesheet_entry_id
    FOR SHARE OF timesheet;
    IF parent_status = 'approved' THEN
      RAISE EXCEPTION 'Approved timesheet entry job codes are immutable; mark the timesheet as adjusted before changing entries';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    SELECT timesheet.status INTO parent_status
    FROM public.timesheet_entries entry
    JOIN public.timesheets timesheet ON timesheet.id = entry.timesheet_id
    WHERE entry.id = OLD.timesheet_entry_id
    FOR SHARE OF timesheet;
    IF parent_status = 'approved' THEN
      RAISE EXCEPTION 'Approved timesheet entry job codes are immutable; mark the timesheet as adjusted before changing entries';
    END IF;
    RETURN OLD;
  END IF;

  SELECT timesheet.status INTO parent_status
  FROM public.timesheet_entries entry
  JOIN public.timesheets timesheet ON timesheet.id = entry.timesheet_id
  WHERE entry.id = OLD.timesheet_entry_id
  FOR SHARE OF timesheet;
  IF parent_status = 'approved' THEN
    RAISE EXCEPTION 'Approved timesheet entry job codes are immutable; mark the timesheet as adjusted before changing entries';
  END IF;

  IF NEW.timesheet_entry_id IS DISTINCT FROM OLD.timesheet_entry_id THEN
    SELECT timesheet.status INTO parent_status
    FROM public.timesheet_entries entry
    JOIN public.timesheets timesheet ON timesheet.id = entry.timesheet_id
    WHERE entry.id = NEW.timesheet_entry_id
    FOR SHARE OF timesheet;
    IF parent_status = 'approved' THEN
      RAISE EXCEPTION 'Approved timesheet entry job codes are immutable; mark the timesheet as adjusted before changing entries';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_timesheet_payroll_approval()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_rollout_applies BOOLEAN;
  v_snapshot_valid BOOLEAN;
  v_revision_valid BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.payroll_rollout_activations activation
    WHERE activation.effective_week_ending <= NEW.week_ending
  ) INTO v_rollout_applies;

  IF NOT v_rollout_applies THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.timesheet_payroll_snapshots snapshot
    WHERE snapshot.id = NEW.current_payroll_snapshot_id
      AND snapshot.timesheet_id = NEW.id
  ) INTO v_snapshot_valid;

  IF NEW.status IN ('approved', 'processed', 'adjusted') AND NOT v_snapshot_valid THEN
    RAISE EXCEPTION 'Post-cutover approval requires a payroll snapshot';
  END IF;

  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    IF OLD.current_payroll_snapshot_id IS NOT NULL
       AND NEW.current_payroll_snapshot_id IS NOT DISTINCT FROM OLD.current_payroll_snapshot_id
    THEN
      RAISE EXCEPTION 'Reapproval must append a snapshot revision';
    END IF;
  END IF;

  IF OLD.current_payroll_snapshot_id IS DISTINCT FROM NEW.current_payroll_snapshot_id THEN
    IF NEW.status <> 'approved' OR NOT v_snapshot_valid THEN
      RAISE EXCEPTION 'Payroll snapshot pointer can only change during approval';
    END IF;

    IF OLD.current_payroll_snapshot_id IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.timesheet_payroll_snapshots snapshot
        WHERE snapshot.id = NEW.current_payroll_snapshot_id
          AND snapshot.timesheet_id = NEW.id
          AND snapshot.supersedes_snapshot_id = OLD.current_payroll_snapshot_id
      ) INTO v_revision_valid;

      IF NOT v_revision_valid THEN
        RAISE EXCEPTION 'Reapproval must append a snapshot revision';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
