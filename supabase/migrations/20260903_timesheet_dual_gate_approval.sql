-- finalise-phase: predeploy
-- Dual-gate timesheet approval: independent Payroll Received and Manager Approved,
-- plus an audit table for privileged payroll edits. Do not apply to production
-- in this task without explicit authorization.

BEGIN;

ALTER TABLE public.timesheets
  ADD COLUMN IF NOT EXISTS payroll_received_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS payroll_received_by UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manager_approved_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS manager_approved_by UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_timesheets_payroll_received_by
  ON public.timesheets (payroll_received_by)
  WHERE payroll_received_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_timesheets_manager_approved_by
  ON public.timesheets (manager_approved_by)
  WHERE manager_approved_by IS NOT NULL;

UPDATE public.timesheets
SET
  payroll_received_at = COALESCE(reviewed_at, processed_at, updated_at, submitted_at, created_at),
  payroll_received_by = reviewed_by
WHERE status IN ('approved', 'processed')
  AND payroll_received_at IS NULL;

UPDATE public.timesheets
SET
  manager_approved_at = COALESCE(processed_at, reviewed_at, updated_at, created_at)
WHERE status = 'processed'
  AND manager_approved_at IS NULL;

ALTER TABLE public.timesheets
  DROP CONSTRAINT IF EXISTS timesheets_status_check;

ALTER TABLE public.timesheets
  ADD CONSTRAINT timesheets_status_check
  CHECK (status IN (
    'draft',
    'submitted',
    'approved',
    'rejected',
    'processed',
    'adjusted',
    'manager_approved'
  ));

ALTER TABLE public.timesheets
  DROP CONSTRAINT IF EXISTS timesheets_status_gate_check;

ALTER TABLE public.timesheets
  ADD CONSTRAINT timesheets_status_gate_check
  CHECK (
    (
      status = 'submitted'
      AND payroll_received_at IS NULL
      AND manager_approved_at IS NULL
    )
    OR (
      status = 'approved'
      AND payroll_received_at IS NOT NULL
      AND manager_approved_at IS NULL
    )
    OR (
      status = 'manager_approved'
      AND payroll_received_at IS NULL
      AND manager_approved_at IS NOT NULL
    )
    OR (
      status = 'processed'
      AND payroll_received_at IS NOT NULL
      AND manager_approved_at IS NOT NULL
    )
    OR (
      status IN ('draft', 'rejected', 'adjusted')
      AND payroll_received_at IS NULL
      AND manager_approved_at IS NULL
    )
  );

CREATE TABLE IF NOT EXISTS public.timesheet_payroll_edits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timesheet_id UUID NOT NULL REFERENCES public.timesheets(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  pay_impact BOOLEAN NOT NULL,
  client_pay_impact BOOLEAN NULL,
  idempotency_key UUID NOT NULL,
  request_fingerprint TEXT NOT NULL,
  before_hash TEXT NULL,
  after_hash TEXT NULL,
  before_status TEXT NOT NULL,
  after_status TEXT NOT NULL,
  before_snapshot_id UUID NULL REFERENCES public.timesheet_payroll_snapshots(id) ON DELETE SET NULL,
  after_snapshot_id UUID NULL REFERENCES public.timesheet_payroll_snapshots(id) ON DELETE SET NULL,
  before_totals JSONB NULL,
  after_totals JSONB NULL,
  notification_user_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_timesheet_payroll_edits_timesheet_created
  ON public.timesheet_payroll_edits (timesheet_id, created_at DESC);

ALTER TABLE public.timesheet_payroll_edits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Timesheet authorisers can view payroll edits" ON public.timesheet_payroll_edits;
CREATE POLICY "Timesheet authorisers can view payroll edits"
  ON public.timesheet_payroll_edits
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.timesheets
      WHERE timesheets.id = timesheet_payroll_edits.timesheet_id
        AND (
          timesheets.user_id = (SELECT auth.uid())
          OR public.can_actor_authorise_timesheet(timesheets.user_id)
        )
    )
  );

REVOKE ALL ON TABLE public.timesheet_payroll_edits FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.timesheet_payroll_edits TO authenticated;
GRANT ALL ON TABLE public.timesheet_payroll_edits TO service_role;

-- Owner header: may submit draft/rejected → submitted, but cannot mutate locked statuses.
DROP POLICY IF EXISTS "Users can update own timesheets" ON public.timesheets;
CREATE POLICY "Users can update own timesheets"
  ON public.timesheets
  FOR UPDATE
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND status = ANY (ARRAY['draft'::text, 'rejected'::text])
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND status = ANY (ARRAY['draft'::text, 'rejected'::text, 'submitted'::text])
  );

DROP POLICY IF EXISTS "Timesheet authorisers can mutate draft timesheets" ON public.timesheets;
CREATE POLICY "Timesheet authorisers can mutate draft timesheets"
  ON public.timesheets
  FOR UPDATE
  TO authenticated
  USING (
    public.can_actor_authorise_timesheet(user_id)
    AND status = ANY (ARRAY['draft'::text, 'rejected'::text])
  )
  WITH CHECK (
    public.can_actor_authorise_timesheet(user_id)
    AND status = ANY (ARRAY['draft'::text, 'rejected'::text, 'submitted'::text])
  );

DROP POLICY IF EXISTS "Timesheet authorisers can create employee timesheets" ON public.timesheets;
CREATE POLICY "Timesheet authorisers can create employee timesheets"
  ON public.timesheets
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.can_actor_authorise_timesheet(user_id)
    AND status = ANY (ARRAY['draft'::text, 'rejected'::text])
  );

DROP POLICY IF EXISTS "Users can insert own timesheet entries" ON public.timesheet_entries;
CREATE POLICY "Users can insert own timesheet entries"
  ON public.timesheet_entries
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.timesheets
      WHERE timesheets.id = timesheet_entries.timesheet_id
        AND timesheets.user_id = (SELECT auth.uid())
        AND timesheets.status = ANY (ARRAY['draft'::text, 'rejected'::text])
    )
  );

DROP POLICY IF EXISTS "Users can update own timesheet entries" ON public.timesheet_entries;
CREATE POLICY "Users can update own timesheet entries"
  ON public.timesheet_entries
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.timesheets
      WHERE timesheets.id = timesheet_entries.timesheet_id
        AND timesheets.user_id = (SELECT auth.uid())
        AND timesheets.status = ANY (ARRAY['draft'::text, 'rejected'::text])
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.timesheets
      WHERE timesheets.id = timesheet_entries.timesheet_id
        AND timesheets.user_id = (SELECT auth.uid())
        AND timesheets.status = ANY (ARRAY['draft'::text, 'rejected'::text])
    )
  );

DROP POLICY IF EXISTS "Users can delete own timesheet entries" ON public.timesheet_entries;
CREATE POLICY "Users can delete own timesheet entries"
  ON public.timesheet_entries
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.timesheets
      WHERE timesheets.id = timesheet_entries.timesheet_id
        AND timesheets.user_id = (SELECT auth.uid())
        AND timesheets.status = ANY (ARRAY['draft'::text, 'rejected'::text])
    )
  );

DROP POLICY IF EXISTS "Timesheet authorisers can insert draft entries" ON public.timesheet_entries;
CREATE POLICY "Timesheet authorisers can insert draft entries"
  ON public.timesheet_entries
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.timesheets
      WHERE timesheets.id = timesheet_entries.timesheet_id
        AND public.can_actor_authorise_timesheet(timesheets.user_id)
        AND timesheets.status = ANY (ARRAY['draft'::text, 'rejected'::text])
    )
  );

DROP POLICY IF EXISTS "Timesheet authorisers can update draft entries" ON public.timesheet_entries;
CREATE POLICY "Timesheet authorisers can update draft entries"
  ON public.timesheet_entries
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.timesheets
      WHERE timesheets.id = timesheet_entries.timesheet_id
        AND public.can_actor_authorise_timesheet(timesheets.user_id)
        AND timesheets.status = ANY (ARRAY['draft'::text, 'rejected'::text])
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.timesheets
      WHERE timesheets.id = timesheet_entries.timesheet_id
        AND public.can_actor_authorise_timesheet(timesheets.user_id)
        AND timesheets.status = ANY (ARRAY['draft'::text, 'rejected'::text])
    )
  );

DROP POLICY IF EXISTS "Timesheet authorisers can delete draft entries" ON public.timesheet_entries;
CREATE POLICY "Timesheet authorisers can delete draft entries"
  ON public.timesheet_entries
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.timesheets
      WHERE timesheets.id = timesheet_entries.timesheet_id
        AND public.can_actor_authorise_timesheet(timesheets.user_id)
        AND timesheets.status = ANY (ARRAY['draft'::text, 'rejected'::text])
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
        AND public.timesheets.status = ANY (ARRAY['draft'::text, 'rejected'::text])
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
        AND public.timesheets.status = ANY (ARRAY['draft'::text, 'rejected'::text])
    )
  );

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
        AND public.timesheets.status = ANY (ARRAY['draft'::text, 'rejected'::text])
    )
  );

DROP POLICY IF EXISTS "Timesheet authorisers can insert draft entry job codes" ON public.timesheet_entry_job_codes;
CREATE POLICY "Timesheet authorisers can insert draft entry job codes"
  ON public.timesheet_entry_job_codes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.timesheet_entries
      JOIN public.timesheets ON public.timesheets.id = public.timesheet_entries.timesheet_id
      WHERE public.timesheet_entries.id = public.timesheet_entry_job_codes.timesheet_entry_id
        AND public.can_actor_authorise_timesheet(public.timesheets.user_id)
        AND public.timesheets.status = ANY (ARRAY['draft'::text, 'rejected'::text])
    )
  );

DROP POLICY IF EXISTS "Timesheet authorisers can update draft entry job codes" ON public.timesheet_entry_job_codes;
CREATE POLICY "Timesheet authorisers can update draft entry job codes"
  ON public.timesheet_entry_job_codes
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.timesheet_entries
      JOIN public.timesheets ON public.timesheets.id = public.timesheet_entries.timesheet_id
      WHERE public.timesheet_entries.id = public.timesheet_entry_job_codes.timesheet_entry_id
        AND public.can_actor_authorise_timesheet(public.timesheets.user_id)
        AND public.timesheets.status = ANY (ARRAY['draft'::text, 'rejected'::text])
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.timesheet_entries
      JOIN public.timesheets ON public.timesheets.id = public.timesheet_entries.timesheet_id
      WHERE public.timesheet_entries.id = public.timesheet_entry_job_codes.timesheet_entry_id
        AND public.can_actor_authorise_timesheet(public.timesheets.user_id)
        AND public.timesheets.status = ANY (ARRAY['draft'::text, 'rejected'::text])
    )
  );

DROP POLICY IF EXISTS "Timesheet authorisers can delete draft entry job codes" ON public.timesheet_entry_job_codes;
CREATE POLICY "Timesheet authorisers can delete draft entry job codes"
  ON public.timesheet_entry_job_codes
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.timesheet_entries
      JOIN public.timesheets ON public.timesheets.id = public.timesheet_entries.timesheet_id
      WHERE public.timesheet_entries.id = public.timesheet_entry_job_codes.timesheet_entry_id
        AND public.can_actor_authorise_timesheet(public.timesheets.user_id)
        AND public.timesheets.status = ANY (ARRAY['draft'::text, 'rejected'::text])
    )
  );

-- Dual-gate payroll snapshot pointer: first snapshot may land on processed
-- (manager-first), pay-impact edits may supersede on approved, and reject may
-- clear the current pointer. Payroll-edit sets app.timesheet_payroll_edit=1
-- so locked entry rows can be rewritten in that one transaction.
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

  IF NEW.status IN ('approved', 'processed') AND NOT v_snapshot_valid THEN
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
    IF NEW.current_payroll_snapshot_id IS NULL THEN
      IF NEW.status NOT IN ('rejected', 'draft', 'submitted') THEN
        RAISE EXCEPTION 'Payroll snapshot pointer can only be cleared when returning the timesheet';
      END IF;
    ELSE
      IF NEW.status NOT IN ('approved', 'processed') OR NOT v_snapshot_valid THEN
        RAISE EXCEPTION 'Payroll snapshot pointer can only change during Payroll Received or payroll edit';
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
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_approved_timesheet_entry_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  parent_status text;
BEGIN
  IF current_setting('app.timesheet_payroll_edit', true) = '1' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT status INTO parent_status
    FROM public.timesheets
    WHERE id = NEW.timesheet_id
    FOR SHARE;
    IF parent_status IN ('approved', 'processed', 'adjusted') THEN
      RAISE EXCEPTION 'Timesheet entries are locked after submission. Accounts must use payroll edit.';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    SELECT status INTO parent_status
    FROM public.timesheets
    WHERE id = OLD.timesheet_id
    FOR SHARE;
    IF parent_status IN ('approved', 'processed', 'adjusted') THEN
      RAISE EXCEPTION 'Timesheet entries are locked after submission. Accounts must use payroll edit.';
    END IF;
    RETURN OLD;
  END IF;

  SELECT status INTO parent_status
  FROM public.timesheets
  WHERE id = OLD.timesheet_id
  FOR SHARE;
    IF parent_status IN ('approved', 'processed', 'adjusted') THEN
    RAISE EXCEPTION 'Timesheet entries are locked after submission. Accounts must use payroll edit.';
  END IF;

  IF NEW.timesheet_id IS DISTINCT FROM OLD.timesheet_id THEN
    SELECT status INTO parent_status
    FROM public.timesheets
    WHERE id = NEW.timesheet_id
    FOR SHARE;
    IF parent_status IN ('approved', 'processed', 'adjusted') THEN
      RAISE EXCEPTION 'Timesheet entries are locked after submission. Accounts must use payroll edit.';
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
  IF current_setting('app.timesheet_payroll_edit', true) = '1' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT timesheet.status INTO parent_status
    FROM public.timesheet_entries entry
    JOIN public.timesheets timesheet ON timesheet.id = entry.timesheet_id
    WHERE entry.id = NEW.timesheet_entry_id
    FOR SHARE OF timesheet;
    IF parent_status IN ('approved', 'processed', 'adjusted') THEN
      RAISE EXCEPTION 'Timesheet entry job codes are locked after submission. Accounts must use payroll edit.';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    SELECT timesheet.status INTO parent_status
    FROM public.timesheet_entries entry
    JOIN public.timesheets timesheet ON timesheet.id = entry.timesheet_id
    WHERE entry.id = OLD.timesheet_entry_id
    FOR SHARE OF timesheet;
    IF parent_status IN ('approved', 'processed', 'adjusted') THEN
      RAISE EXCEPTION 'Timesheet entry job codes are locked after submission. Accounts must use payroll edit.';
    END IF;
    RETURN OLD;
  END IF;

  SELECT timesheet.status INTO parent_status
  FROM public.timesheet_entries entry
  JOIN public.timesheets timesheet ON timesheet.id = entry.timesheet_id
  WHERE entry.id = OLD.timesheet_entry_id
  FOR SHARE OF timesheet;
    IF parent_status IN ('approved', 'processed', 'adjusted') THEN
    RAISE EXCEPTION 'Timesheet entry job codes are locked after submission. Accounts must use payroll edit.';
  END IF;

  IF NEW.timesheet_entry_id IS DISTINCT FROM OLD.timesheet_entry_id THEN
    SELECT timesheet.status INTO parent_status
    FROM public.timesheet_entries entry
    JOIN public.timesheets timesheet ON timesheet.id = entry.timesheet_id
    WHERE entry.id = NEW.timesheet_entry_id
    FOR SHARE OF timesheet;
    IF parent_status IN ('approved', 'processed', 'adjusted') THEN
      RAISE EXCEPTION 'Timesheet entry job codes are locked after submission. Accounts must use payroll edit.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DO $$
DECLARE
  mismatch_count integer;
  write_policy_count integer;
BEGIN
  SELECT COUNT(*) INTO mismatch_count
  FROM public.timesheets
  WHERE NOT (
    (
      status = 'submitted'
      AND payroll_received_at IS NULL
      AND manager_approved_at IS NULL
    )
    OR (
      status = 'approved'
      AND payroll_received_at IS NOT NULL
      AND manager_approved_at IS NULL
    )
    OR (
      status = 'manager_approved'
      AND payroll_received_at IS NULL
      AND manager_approved_at IS NOT NULL
    )
    OR (
      status = 'processed'
      AND payroll_received_at IS NOT NULL
      AND manager_approved_at IS NOT NULL
    )
    OR (
      status IN ('draft', 'rejected', 'adjusted')
      AND payroll_received_at IS NULL
      AND manager_approved_at IS NULL
    )
  );

  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'timesheet gate backfill mismatch: % rows', mismatch_count;
  END IF;

  SELECT COUNT(*) INTO mismatch_count
  FROM public.timesheets
  WHERE status IN ('approved', 'processed')
    AND current_payroll_snapshot_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.timesheet_payroll_snapshots snapshot
      WHERE snapshot.id = timesheets.current_payroll_snapshot_id
        AND snapshot.timesheet_id = timesheets.id
    );

  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'timesheet snapshot pointer mismatch: % rows', mismatch_count;
  END IF;

  SELECT COUNT(*) INTO write_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('timesheets', 'timesheet_entries', 'timesheet_entry_job_codes')
    AND cmd IN ('INSERT', 'UPDATE', 'DELETE')
    AND (
      qual ILIKE '%effective_is_manager_admin%'
      OR with_check ILIKE '%effective_is_manager_admin%'
    );

  IF write_policy_count <> 0 THEN
    RAISE EXCEPTION 'timesheet manager write policies still present: %', write_policy_count;
  END IF;
END $$;

COMMIT;
