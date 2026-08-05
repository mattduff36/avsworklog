BEGIN;

CREATE OR REPLACE FUNCTION public.payroll_is_full_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    LEFT JOIN public.roles r ON r.id = p.role_id
    WHERE p.id = auth.uid()
      AND (
        COALESCE(p.super_admin, false)
        OR COALESCE(r.is_super_admin, false)
        OR r.role_class = 'admin'
        OR lower(COALESCE(r.name, '')) = 'admin'
      )
  );
$$;

CREATE TABLE IF NOT EXISTS public.payroll_rule_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key TEXT NOT NULL UNIQUE CHECK (rule_key IN ('lorries', 'civils', 'plant', 'others')),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.payroll_rule_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_set_id UUID NOT NULL REFERENCES public.payroll_rule_sets(id) ON DELETE RESTRICT,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  effective_week_ending DATE NULL,
  config_schema_version INTEGER NOT NULL DEFAULT 1 CHECK (config_schema_version > 0),
  break_threshold_minutes INTEGER NOT NULL CHECK (break_threshold_minutes >= 0),
  break_deduction_minutes INTEGER NOT NULL CHECK (
    break_deduction_minutes >= 0
    AND break_deduction_minutes <= break_threshold_minutes
  ),
  bank_holiday_treatment TEXT NOT NULL CHECK (
    bank_holiday_treatment IN ('basic', 'overtime', 'double_time')
  ),
  night_shift_treatment TEXT NULL CHECK (
    night_shift_treatment IS NULL
    OR night_shift_treatment IN ('basic', 'overtime', 'double_time')
  ),
  operator_travel_enabled BOOLEAN NOT NULL DEFAULT false,
  ipr_units_per_worked_day NUMERIC(4, 2) NOT NULL DEFAULT 0 CHECK (ipr_units_per_worked_day >= 0),
  ipr_weekly_cap NUMERIC(4, 2) NOT NULL DEFAULT 0 CHECK (ipr_weekly_cap >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  activated_at TIMESTAMPTZ NULL,
  activated_by UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  UNIQUE (rule_set_id, version_number),
  CHECK (
    (status = 'draft' AND effective_week_ending IS NULL AND activated_at IS NULL)
    OR (status IN ('active', 'archived') AND effective_week_ending IS NOT NULL AND activated_at IS NOT NULL)
  ),
  CHECK (
    effective_week_ending IS NULL
    OR EXTRACT(ISODOW FROM effective_week_ending) = 7
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS payroll_rule_versions_effective_unique
  ON public.payroll_rule_versions(rule_set_id, effective_week_ending)
  WHERE effective_week_ending IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.payroll_rule_day_bands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_version_id UUID NOT NULL REFERENCES public.payroll_rule_versions(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  treatment TEXT NOT NULL CHECK (treatment IN ('basic', 'overtime', 'double_time')),
  up_to_minutes INTEGER NULL CHECK (up_to_minutes IS NULL OR up_to_minutes > 0),
  remainder_treatment TEXT NULL CHECK (
    remainder_treatment IS NULL
    OR remainder_treatment IN ('basic', 'overtime', 'double_time')
  ),
  UNIQUE (rule_version_id, day_of_week),
  CHECK (
    (up_to_minutes IS NULL AND remainder_treatment IS NULL)
    OR (up_to_minutes IS NOT NULL AND remainder_treatment IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.payroll_team_rule_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id TEXT NOT NULL REFERENCES public.org_teams(id) ON DELETE RESTRICT,
  rule_set_id UUID NOT NULL REFERENCES public.payroll_rule_sets(id) ON DELETE RESTRICT,
  effective_week_ending DATE NOT NULL CHECK (EXTRACT(ISODOW FROM effective_week_ending) = 7),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  UNIQUE (team_id, effective_week_ending)
);

CREATE TABLE IF NOT EXISTS public.payroll_profile_rule_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  rule_set_id UUID NULL REFERENCES public.payroll_rule_sets(id) ON DELETE RESTRICT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  effective_week_ending DATE NOT NULL CHECK (EXTRACT(ISODOW FROM effective_week_ending) = 7),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  UNIQUE (profile_id, effective_week_ending),
  CONSTRAINT payroll_profile_assignment_state_check CHECK (
    (is_active AND rule_set_id IS NOT NULL)
    OR (NOT is_active AND rule_set_id IS NULL)
  )
);

ALTER TABLE public.payroll_profile_rule_assignments
  ALTER COLUMN rule_set_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'payroll_profile_assignment_state_check'
      AND conrelid = 'public.payroll_profile_rule_assignments'::regclass
  ) THEN
    ALTER TABLE public.payroll_profile_rule_assignments
      ADD CONSTRAINT payroll_profile_assignment_state_check CHECK (
        (is_active AND rule_set_id IS NOT NULL)
        OR (NOT is_active AND rule_set_id IS NULL)
      );
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.payroll_rollout_activations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  effective_week_ending DATE NOT NULL UNIQUE CHECK (EXTRACT(ISODOW FROM effective_week_ending) = 7),
  activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_by UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes TEXT NULL
);

CREATE TABLE IF NOT EXISTS public.timesheet_payroll_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timesheet_id UUID NOT NULL REFERENCES public.timesheets(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision > 0),
  supersedes_snapshot_id UUID NULL REFERENCES public.timesheet_payroll_snapshots(id) ON DELETE RESTRICT,
  rule_set_id UUID NOT NULL REFERENCES public.payroll_rule_sets(id) ON DELETE RESTRICT,
  rule_version_id UUID NOT NULL REFERENCES public.payroll_rule_versions(id) ON DELETE RESTRICT,
  assignment_source TEXT NOT NULL CHECK (assignment_source IN ('profile', 'team', 'fallback')),
  assignment_source_id TEXT NULL,
  engine_version INTEGER NOT NULL DEFAULT 1 CHECK (engine_version > 0),
  input_hash TEXT NOT NULL,
  idempotency_key UUID NOT NULL UNIQUE,
  basic_minutes INTEGER NOT NULL CHECK (basic_minutes >= 0),
  overtime_minutes INTEGER NOT NULL CHECK (overtime_minutes >= 0),
  double_time_minutes INTEGER NOT NULL CHECK (double_time_minutes >= 0),
  payable_minutes INTEGER NOT NULL CHECK (
    payable_minutes >= 0
    AND payable_minutes = basic_minutes + overtime_minutes + double_time_minutes
  ),
  paid_leave_units NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (paid_leave_units >= 0),
  unpaid_leave_units NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (unpaid_leave_units >= 0),
  operator_travel_minutes INTEGER NOT NULL DEFAULT 0 CHECK (operator_travel_minutes >= 0),
  ipr_units NUMERIC(4, 2) NOT NULL DEFAULT 0 CHECK (ipr_units >= 0),
  subsistence_days INTEGER NOT NULL DEFAULT 0 CHECK (subsistence_days >= 0),
  subsistence_day_names TEXT[] NOT NULL DEFAULT '{}',
  source_evidence JSONB NOT NULL,
  approved_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (timesheet_id, revision)
);

CREATE INDEX IF NOT EXISTS timesheet_payroll_snapshots_timesheet_idx
  ON public.timesheet_payroll_snapshots(timesheet_id, revision DESC);
CREATE INDEX IF NOT EXISTS timesheet_payroll_snapshots_rule_version_idx
  ON public.timesheet_payroll_snapshots(rule_version_id);

CREATE TABLE IF NOT EXISTS public.timesheet_payroll_snapshot_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES public.timesheet_payroll_snapshots(id) ON DELETE RESTRICT,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  entry_date DATE NOT NULL,
  rounded_time_started TIME NULL,
  rounded_time_finished TIME NULL,
  elapsed_minutes INTEGER NOT NULL CHECK (elapsed_minutes >= 0),
  break_minutes INTEGER NOT NULL CHECK (break_minutes >= 0),
  payable_minutes INTEGER NOT NULL CHECK (payable_minutes >= 0),
  basic_minutes INTEGER NOT NULL CHECK (basic_minutes >= 0),
  overtime_minutes INTEGER NOT NULL CHECK (overtime_minutes >= 0),
  double_time_minutes INTEGER NOT NULL CHECK (double_time_minutes >= 0),
  paid_leave_units NUMERIC(3, 1) NOT NULL DEFAULT 0 CHECK (paid_leave_units IN (0, 0.5, 1)),
  unpaid_leave_units NUMERIC(3, 1) NOT NULL DEFAULT 0 CHECK (unpaid_leave_units IN (0, 0.5, 1)),
  operator_travel_minutes INTEGER NOT NULL DEFAULT 0 CHECK (operator_travel_minutes >= 0),
  ipr_units NUMERIC(3, 1) NOT NULL DEFAULT 0 CHECK (ipr_units >= 0),
  subsistence BOOLEAN NOT NULL DEFAULT false,
  treatment_reason TEXT NOT NULL CHECK (
    treatment_reason IN ('did_not_work', 'bank_holiday', 'night_shift', 'calendar')
  ),
  UNIQUE (snapshot_id, day_of_week),
  CHECK (payable_minutes = basic_minutes + overtime_minutes + double_time_minutes)
);

ALTER TABLE public.timesheets
  ADD COLUMN IF NOT EXISTS current_payroll_snapshot_id UUID NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'timesheets_current_payroll_snapshot_id_fkey'
  ) THEN
    ALTER TABLE public.timesheets
      ADD CONSTRAINT timesheets_current_payroll_snapshot_id_fkey
      FOREIGN KEY (current_payroll_snapshot_id)
      REFERENCES public.timesheet_payroll_snapshots(id)
      ON DELETE RESTRICT;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_immutable_payroll_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Payroll history is immutable';
END;
$$;

DROP TRIGGER IF EXISTS reject_payroll_snapshot_update_delete ON public.timesheet_payroll_snapshots;
CREATE TRIGGER reject_payroll_snapshot_update_delete
  BEFORE UPDATE OR DELETE ON public.timesheet_payroll_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_payroll_change();

DROP TRIGGER IF EXISTS reject_payroll_snapshot_day_update_delete ON public.timesheet_payroll_snapshot_days;
CREATE TRIGGER reject_payroll_snapshot_day_update_delete
  BEFORE UPDATE OR DELETE ON public.timesheet_payroll_snapshot_days
  FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_payroll_change();

CREATE OR REPLACE FUNCTION public.protect_activated_payroll_rule()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'active'
    AND TG_OP = 'UPDATE'
    AND NEW.status = 'archived'
    AND (
      to_jsonb(NEW) - ARRAY['status', 'updated_at', 'updated_by']::TEXT[]
    ) = (
      to_jsonb(OLD) - ARRAY['status', 'updated_at', 'updated_by']::TEXT[]
    )
  THEN
    RETURN NEW;
  END IF;
  IF OLD.status IN ('active', 'archived') THEN
    RAISE EXCEPTION 'Activated payroll rule versions are immutable';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS protect_activated_payroll_rule ON public.payroll_rule_versions;
CREATE TRIGGER protect_activated_payroll_rule
  BEFORE UPDATE OR DELETE ON public.payroll_rule_versions
  FOR EACH ROW EXECUTE FUNCTION public.protect_activated_payroll_rule();

CREATE OR REPLACE FUNCTION public.protect_activated_payroll_rule_band()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_version_id UUID;
  v_status TEXT;
BEGIN
  v_version_id := COALESCE(NEW.rule_version_id, OLD.rule_version_id);
  SELECT status INTO v_status
  FROM public.payroll_rule_versions
  WHERE id = v_version_id;
  IF v_status IN ('active', 'archived') THEN
    RAISE EXCEPTION 'Activated payroll rule bands are immutable';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS protect_activated_payroll_rule_band ON public.payroll_rule_day_bands;
CREATE TRIGGER protect_activated_payroll_rule_band
  BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_rule_day_bands
  FOR EACH ROW EXECUTE FUNCTION public.protect_activated_payroll_rule_band();

DROP TRIGGER IF EXISTS reject_payroll_team_assignment_update_delete ON public.payroll_team_rule_assignments;
CREATE TRIGGER reject_payroll_team_assignment_update_delete
  BEFORE UPDATE OR DELETE ON public.payroll_team_rule_assignments
  FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_payroll_change();

DROP TRIGGER IF EXISTS reject_payroll_profile_assignment_update_delete ON public.payroll_profile_rule_assignments;
CREATE TRIGGER reject_payroll_profile_assignment_update_delete
  BEFORE UPDATE OR DELETE ON public.payroll_profile_rule_assignments
  FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_payroll_change();

DROP TRIGGER IF EXISTS reject_payroll_rollout_update_delete ON public.payroll_rollout_activations;
CREATE TRIGGER reject_payroll_rollout_update_delete
  BEFORE UPDATE OR DELETE ON public.payroll_rollout_activations
  FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_payroll_change();

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

  -- Any transition into approved after a prior snapshot must append a new revision.
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

DROP TRIGGER IF EXISTS guard_timesheet_payroll_approval ON public.timesheets;
CREATE TRIGGER guard_timesheet_payroll_approval
  BEFORE UPDATE OF status, current_payroll_snapshot_id ON public.timesheets
  FOR EACH ROW EXECUTE FUNCTION public.guard_timesheet_payroll_approval();

-- Approved timesheets keep immutable source rows until status leaves approved.
-- UPDATE checks both OLD and NEW parents so rows cannot be re-parented away.
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

DROP TRIGGER IF EXISTS reject_approved_timesheet_entry_mutation ON public.timesheet_entries;
CREATE TRIGGER reject_approved_timesheet_entry_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON public.timesheet_entries
  FOR EACH ROW EXECUTE FUNCTION public.reject_approved_timesheet_entry_mutation();

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

DROP TRIGGER IF EXISTS reject_approved_timesheet_entry_job_code_mutation ON public.timesheet_entry_job_codes;
CREATE TRIGGER reject_approved_timesheet_entry_job_code_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON public.timesheet_entry_job_codes
  FOR EACH ROW EXECUTE FUNCTION public.reject_approved_timesheet_entry_job_code_mutation();

DROP TRIGGER IF EXISTS set_updated_at_payroll_rule_sets ON public.payroll_rule_sets;
CREATE TRIGGER set_updated_at_payroll_rule_sets
  BEFORE UPDATE ON public.payroll_rule_sets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at_payroll_rule_versions ON public.payroll_rule_versions;
CREATE TRIGGER set_updated_at_payroll_rule_versions
  BEFORE UPDATE ON public.payroll_rule_versions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.payroll_rule_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_rule_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_rule_day_bands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_team_rule_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_profile_rule_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_rollout_activations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timesheet_payroll_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timesheet_payroll_snapshot_days ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Payroll rule sets readable" ON public.payroll_rule_sets;
CREATE POLICY "Payroll rule sets readable" ON public.payroll_rule_sets
  FOR SELECT TO authenticated
  USING (status = 'active' OR (SELECT public.payroll_is_full_admin()));
DROP POLICY IF EXISTS "Payroll rule sets admin managed" ON public.payroll_rule_sets;
CREATE POLICY "Payroll rule sets admin managed" ON public.payroll_rule_sets
  FOR ALL TO authenticated
  USING ((SELECT public.payroll_is_full_admin()))
  WITH CHECK ((SELECT public.payroll_is_full_admin()));

DROP POLICY IF EXISTS "Payroll rule versions readable" ON public.payroll_rule_versions;
CREATE POLICY "Payroll rule versions readable" ON public.payroll_rule_versions
  FOR SELECT TO authenticated
  USING (status = 'active' OR (SELECT public.payroll_is_full_admin()));
DROP POLICY IF EXISTS "Payroll rule versions admin managed" ON public.payroll_rule_versions;
CREATE POLICY "Payroll rule versions admin managed" ON public.payroll_rule_versions
  FOR ALL TO authenticated
  USING ((SELECT public.payroll_is_full_admin()))
  WITH CHECK ((SELECT public.payroll_is_full_admin()));

DROP POLICY IF EXISTS "Payroll day bands readable" ON public.payroll_rule_day_bands;
CREATE POLICY "Payroll day bands readable" ON public.payroll_rule_day_bands
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.payroll_rule_versions version
      WHERE version.id = rule_version_id
        AND (version.status = 'active' OR (SELECT public.payroll_is_full_admin()))
    )
  );
DROP POLICY IF EXISTS "Payroll day bands admin managed" ON public.payroll_rule_day_bands;
CREATE POLICY "Payroll day bands admin managed" ON public.payroll_rule_day_bands
  FOR ALL TO authenticated
  USING ((SELECT public.payroll_is_full_admin()))
  WITH CHECK ((SELECT public.payroll_is_full_admin()));

DROP POLICY IF EXISTS "Payroll team assignments readable" ON public.payroll_team_rule_assignments;
CREATE POLICY "Payroll team assignments readable" ON public.payroll_team_rule_assignments
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Payroll team assignments admin insert" ON public.payroll_team_rule_assignments;
CREATE POLICY "Payroll team assignments admin insert" ON public.payroll_team_rule_assignments
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.payroll_is_full_admin()));

DROP POLICY IF EXISTS "Payroll profile assignments readable" ON public.payroll_profile_rule_assignments;
CREATE POLICY "Payroll profile assignments readable" ON public.payroll_profile_rule_assignments
  FOR SELECT TO authenticated
  USING (
    profile_id = auth.uid()
    OR (SELECT public.payroll_is_full_admin())
    OR (SELECT public.effective_has_module_permission('approvals'))
  );
DROP POLICY IF EXISTS "Payroll profile assignments admin insert" ON public.payroll_profile_rule_assignments;
CREATE POLICY "Payroll profile assignments admin insert" ON public.payroll_profile_rule_assignments
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.payroll_is_full_admin()));

DROP POLICY IF EXISTS "Payroll rollout readable" ON public.payroll_rollout_activations;
CREATE POLICY "Payroll rollout readable" ON public.payroll_rollout_activations
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Payroll rollout admin insert" ON public.payroll_rollout_activations;
CREATE POLICY "Payroll rollout admin insert" ON public.payroll_rollout_activations
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.payroll_is_full_admin()));

-- Owner/admin RLS only. Elevated manager reads must go through scoped APIs that
-- apply filterTimesheetRowsForReportScope (service role bypasses RLS).
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

INSERT INTO public.payroll_rule_sets (rule_key, name, status)
VALUES
  ('lorries', 'Transport', 'draft'),
  ('civils', 'Civils', 'draft'),
  ('plant', 'Plant', 'draft'),
  ('others', 'Others', 'draft')
ON CONFLICT (rule_key) DO NOTHING;

WITH seed_versions(rule_key, break_threshold, break_deduction, bank_treatment, night_treatment, travel, ipr_day, ipr_cap) AS (
  VALUES
    ('lorries', 360, 30, 'double_time', NULL::TEXT, false, 0.0, 0.0),
    ('civils', 360, 30, 'double_time', 'double_time', false, 0.0, 0.0),
    ('plant', 360, 30, 'double_time', 'double_time', true, 0.2, 1.0),
    ('others', 360, 30, 'double_time', 'double_time', false, 0.0, 0.0)
)
INSERT INTO public.payroll_rule_versions (
  rule_set_id,
  version_number,
  status,
  break_threshold_minutes,
  break_deduction_minutes,
  bank_holiday_treatment,
  night_shift_treatment,
  operator_travel_enabled,
  ipr_units_per_worked_day,
  ipr_weekly_cap
)
SELECT
  rule_set.id,
  1,
  'draft',
  seed.break_threshold,
  seed.break_deduction,
  seed.bank_treatment,
  seed.night_treatment,
  seed.travel,
  seed.ipr_day,
  seed.ipr_cap
FROM seed_versions seed
JOIN public.payroll_rule_sets rule_set ON rule_set.rule_key = seed.rule_key
ON CONFLICT (rule_set_id, version_number) DO NOTHING;

WITH bands(rule_key, day_of_week, treatment, up_to_minutes, remainder_treatment) AS (
  VALUES
    ('lorries', 1, 'basic', NULL::INTEGER, NULL::TEXT),
    ('lorries', 2, 'basic', NULL, NULL),
    ('lorries', 3, 'basic', NULL, NULL),
    ('lorries', 4, 'basic', NULL, NULL),
    ('lorries', 5, 'basic', NULL, NULL),
    ('lorries', 6, 'overtime', 240, 'double_time'),
    ('lorries', 7, 'double_time', NULL, NULL),
    ('civils', 1, 'basic', NULL, NULL),
    ('civils', 2, 'basic', NULL, NULL),
    ('civils', 3, 'basic', NULL, NULL),
    ('civils', 4, 'basic', NULL, NULL),
    ('civils', 5, 'basic', NULL, NULL),
    ('civils', 6, 'overtime', NULL, NULL),
    ('civils', 7, 'overtime', NULL, NULL),
    ('plant', 1, 'basic', 480, 'overtime'),
    ('plant', 2, 'basic', 480, 'overtime'),
    ('plant', 3, 'basic', 480, 'overtime'),
    ('plant', 4, 'basic', 480, 'overtime'),
    ('plant', 5, 'basic', 420, 'overtime'),
    ('plant', 6, 'overtime', 240, 'double_time'),
    ('plant', 7, 'double_time', NULL, NULL),
    ('others', 1, 'basic', 480, 'overtime'),
    ('others', 2, 'basic', 480, 'overtime'),
    ('others', 3, 'basic', 480, 'overtime'),
    ('others', 4, 'basic', 480, 'overtime'),
    ('others', 5, 'basic', 420, 'overtime'),
    ('others', 6, 'overtime', 240, 'double_time'),
    ('others', 7, 'double_time', NULL, NULL)
)
INSERT INTO public.payroll_rule_day_bands (
  rule_version_id,
  day_of_week,
  treatment,
  up_to_minutes,
  remainder_treatment
)
SELECT
  version.id,
  band.day_of_week,
  band.treatment,
  band.up_to_minutes,
  band.remainder_treatment
FROM bands band
JOIN public.payroll_rule_sets rule_set ON rule_set.rule_key = band.rule_key
JOIN public.payroll_rule_versions version
  ON version.rule_set_id = rule_set.id
 AND version.version_number = 1
WHERE NOT EXISTS (
  SELECT 1
  FROM public.payroll_rule_day_bands existing
  WHERE existing.rule_version_id = version.id
    AND existing.day_of_week = band.day_of_week
)
ON CONFLICT (rule_version_id, day_of_week) DO NOTHING;

COMMIT;
