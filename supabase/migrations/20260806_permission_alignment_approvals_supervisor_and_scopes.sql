-- Phase 4: broaden scoped access without restoring role-wide timesheet access.
-- Workstream: ws_permission_alignment_20260806

BEGIN;

UPDATE public.permission_modules
SET
  minimum_role_id = (
    SELECT id
    FROM public.roles
    WHERE LOWER(name) = 'supervisor'
    ORDER BY hierarchy_rank ASC
    LIMIT 1
  ),
  updated_at = NOW()
WHERE module_name = 'approvals';

CREATE OR REPLACE FUNCTION public.module_enforced_minimum_access_level(target_module TEXT)
RETURNS INTEGER AS $$
DECLARE
  configured_min_rank INTEGER;
  hard_rule_min_rank INTEGER;
BEGIN
  SELECT r.hierarchy_rank
  INTO configured_min_rank
  FROM public.permission_modules pm
  JOIN public.roles r ON r.id = pm.minimum_role_id
  WHERE pm.module_name = target_module;

  hard_rule_min_rank := CASE target_module
    WHEN 'approvals' THEN 3
    WHEN 'toolbox-talks' THEN 4
    WHEN 'admin-settings' THEN 5
    ELSE NULL
  END;

  configured_min_rank := COALESCE(configured_min_rank, 0);

  IF hard_rule_min_rank IS NOT NULL AND hard_rule_min_rank > configured_min_rank THEN
    configured_min_rank := hard_rule_min_rank;
  END IF;

  RETURN LEAST(GREATEST(configured_min_rank, 0), 5);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.permission_alignment_effective_module_access_level(
  target_module TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.view_as_role_id() IS NOT NULL OR public.view_as_team_id() IS NOT NULL THEN
    RETURN public.role_on_team_module_access_level(
      public.effective_role_id(),
      public.effective_team_id(),
      target_module
    );
  END IF;

  RETURN public.effective_module_access_level(target_module);
END;
$$;

-- Keep SQL secondary defaults aligned with the TypeScript resolver: use the
-- effective Absence module level first, then fall back to the underlying role
-- when the module is unavailable.
CREATE OR REPLACE FUNCTION public.absence_secondary_role_tier(
  actor_profile_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  absence_level INTEGER;
  actor_role_id UUID;
  actor_team_id TEXT;
  role_name TEXT;
  role_class TEXT;
  role_is_super_admin BOOLEAN;
  role_is_manager_admin BOOLEAN;
BEGIN
  IF actor_profile_id IS NULL THEN
    RETURN 'employee';
  END IF;

  IF actor_profile_id = auth.uid() THEN
    absence_level := public.permission_alignment_effective_module_access_level('absence');
    actor_role_id := public.effective_role_id();
  ELSE
    SELECT p.role_id, p.team_id
    INTO actor_role_id, actor_team_id
    FROM public.profiles p
    WHERE p.id = actor_profile_id;

    absence_level := public.user_module_access_level(
      actor_profile_id,
      actor_role_id,
      actor_team_id,
      'absence'
    );
  END IF;

  IF absence_level >= 5 THEN
    RETURN 'admin';
  ELSIF absence_level >= 4 THEN
    RETURN 'manager';
  ELSIF absence_level >= 3 THEN
    RETURN 'supervisor';
  ELSIF absence_level > 0 THEN
    RETURN 'employee';
  END IF;

  SELECT
    r.name,
    r.role_class,
    COALESCE(r.is_super_admin, FALSE),
    COALESCE(r.is_manager_admin, FALSE)
  INTO
    role_name,
    role_class,
    role_is_super_admin,
    role_is_manager_admin
  FROM public.roles r
  WHERE r.id = actor_role_id;

  IF role_is_super_admin OR role_name = 'admin' OR role_class = 'admin' THEN
    RETURN 'admin';
  END IF;

  IF role_class = 'manager' OR role_is_manager_admin THEN
    RETURN 'manager';
  END IF;

  IF LOWER(COALESCE(role_name, '')) = 'supervisor' THEN
    RETURN 'supervisor';
  END IF;

  RETURN 'employee';
END;
$$;

CREATE OR REPLACE FUNCTION public.permission_alignment_absence_secondary_effective_cell(
  permission_key TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.view_as_role_id() IS NOT NULL OR public.view_as_team_id() IS NOT NULL THEN
    RETURN public.absence_secondary_default_cell(auth.uid(), permission_key);
  END IF;

  RETURN public.absence_secondary_effective_cell(auth.uid(), permission_key);
END;
$$;

CREATE OR REPLACE FUNCTION public.are_effective_actor_and_target_in_same_team(
  target_profile_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    public.effective_team_id() IS NOT NULL
    AND target_profile_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles target
      WHERE target.id = target_profile_id
        AND target.team_id = public.effective_team_id()
    );
$$;

CREATE OR REPLACE FUNCTION public.effective_accounts_timesheet_full_visibility_override()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.roles r
    JOIN public.org_teams t ON t.id = public.effective_team_id()
    WHERE r.id = public.effective_role_id()
      AND LOWER(TRIM(t.name)) = 'accounts'
      AND LOWER(TRIM(r.name)) IN ('manager', 'supervisor')
  );
$$;

COMMENT ON FUNCTION public.effective_accounts_timesheet_full_visibility_override()
  IS 'Matches the application Accounts Manager/Supervisor global timesheet visibility override.';

CREATE OR REPLACE FUNCTION public.can_actor_authorise_timesheet(target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR target_user_id IS NULL OR auth.uid() = target_user_id THEN
    RETURN FALSE;
  END IF;

  IF public.permission_alignment_effective_module_access_level('approvals') < 3 THEN
    RETURN FALSE;
  END IF;

  IF public.effective_accounts_timesheet_full_visibility_override() THEN
    RETURN TRUE;
  END IF;

  IF public.permission_alignment_absence_secondary_effective_cell('authorise_bookings_all') IS TRUE THEN
    RETURN TRUE;
  END IF;

  RETURN (
    public.permission_alignment_absence_secondary_effective_cell('authorise_bookings_team') IS TRUE
    AND public.are_effective_actor_and_target_in_same_team(target_user_id)
  );
END;
$$;

COMMENT ON FUNCTION public.can_actor_authorise_timesheet(UUID)
  IS 'Approvals Level 3+ plus ALL/TEAM absence authorisation scope, or the Accounts override; always denies self.';

CREATE OR REPLACE FUNCTION public.can_actor_view_timesheet(target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND target_user_id IS NOT NULL
    AND (
      auth.uid() = target_user_id
      OR public.can_actor_authorise_timesheet(target_user_id)
    );
$$;

CREATE OR REPLACE FUNCTION public.can_actor_view_timesheet_entry(target_timesheet_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.timesheets t
    WHERE t.id = target_timesheet_id
      AND public.can_actor_view_timesheet(t.user_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.can_actor_view_timesheet_entry_job_codes(
  target_timesheet_entry_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.timesheet_entries entry
    WHERE entry.id = target_timesheet_entry_id
      AND public.can_actor_view_timesheet_entry(entry.timesheet_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.can_actor_view_employee_work_shift(target_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR target_profile_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF auth.uid() = target_profile_id THEN
    RETURN TRUE;
  END IF;

  IF public.permission_alignment_effective_module_access_level('absence') <= 0 THEN
    RETURN FALSE;
  END IF;

  IF public.permission_alignment_absence_secondary_effective_cell('see_manage_work_shifts_all') IS TRUE THEN
    RETURN TRUE;
  END IF;

  RETURN (
    public.permission_alignment_absence_secondary_effective_cell('see_manage_work_shifts_team') IS TRUE
    AND public.are_effective_actor_and_target_in_same_team(target_profile_id)
  );
END;
$$;

COMMENT ON FUNCTION public.can_actor_view_employee_work_shift(UUID)
  IS 'Own work shift or absence-secondary ALL/TEAM work-shift visibility with a non-null exact team match.';

REVOKE ALL ON FUNCTION public.effective_accounts_timesheet_full_visibility_override() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.permission_alignment_effective_module_access_level(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.permission_alignment_absence_secondary_effective_cell(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.are_effective_actor_and_target_in_same_team(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_actor_authorise_timesheet(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_actor_view_timesheet(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_actor_view_timesheet_entry(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_actor_view_timesheet_entry_job_codes(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_actor_view_employee_work_shift(UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.effective_accounts_timesheet_full_visibility_override() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_actor_authorise_timesheet(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_actor_view_timesheet(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_actor_view_timesheet_entry(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_actor_view_timesheet_entry_job_codes(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_actor_view_employee_work_shift(UUID) TO authenticated, service_role;

-- Timesheet reads now follow explicit approval scope. Mutations remain behind
-- server APIs so row access cannot be used to update arbitrary columns.
DROP POLICY IF EXISTS "Managers can view all timesheets" ON public.timesheets;
DROP POLICY IF EXISTS "Managers can view all timesheets for approval" ON public.timesheets;
DROP POLICY IF EXISTS "Timesheet authorisers can view scoped timesheets" ON public.timesheets;
DROP POLICY IF EXISTS "Managers can update all timesheets" ON public.timesheets;
DROP POLICY IF EXISTS "Managers can update timesheets" ON public.timesheets;
DROP POLICY IF EXISTS "Managers can update timesheets for approval" ON public.timesheets;

CREATE POLICY "Timesheet authorisers can view scoped timesheets"
  ON public.timesheets
  FOR SELECT
  TO authenticated
  USING (public.can_actor_authorise_timesheet(user_id));

DROP POLICY IF EXISTS "Managers can view all timesheet entries" ON public.timesheet_entries;
DROP POLICY IF EXISTS "Managers can view all entries" ON public.timesheet_entries;
DROP POLICY IF EXISTS "Managers can delete any timesheet entries" ON public.timesheet_entries;
DROP POLICY IF EXISTS "Managers can insert any timesheet entries" ON public.timesheet_entries;
DROP POLICY IF EXISTS "Managers can update all entries" ON public.timesheet_entries;
DROP POLICY IF EXISTS "Managers can update all timesheet entries" ON public.timesheet_entries;
DROP POLICY IF EXISTS "Timesheet viewers can view scoped entries" ON public.timesheet_entries;

CREATE POLICY "Timesheet viewers can view scoped entries"
  ON public.timesheet_entries
  FOR SELECT
  TO authenticated
  USING (public.can_actor_view_timesheet_entry(timesheet_id));

DROP POLICY IF EXISTS "Managers can delete any timesheet entry job codes" ON public.timesheet_entry_job_codes;
DROP POLICY IF EXISTS "Managers can insert any timesheet entry job codes" ON public.timesheet_entry_job_codes;
DROP POLICY IF EXISTS "Managers can update any timesheet entry job codes" ON public.timesheet_entry_job_codes;
DROP POLICY IF EXISTS "Managers can view all timesheet entry job codes" ON public.timesheet_entry_job_codes;
DROP POLICY IF EXISTS "Timesheet viewers can view scoped entry job codes" ON public.timesheet_entry_job_codes;

CREATE POLICY "Timesheet viewers can view scoped entry job codes"
  ON public.timesheet_entry_job_codes
  FOR SELECT
  TO authenticated
  USING (public.can_actor_view_timesheet_entry_job_codes(timesheet_entry_id));

DROP POLICY IF EXISTS "Users can view own work shift" ON public.employee_work_shifts;
DROP POLICY IF EXISTS "Managers can view all employee work shifts" ON public.employee_work_shifts;
DROP POLICY IF EXISTS "Managers and users can view employee work shifts" ON public.employee_work_shifts;
DROP POLICY IF EXISTS "Absence scoped work shift viewers" ON public.employee_work_shifts;

CREATE POLICY "Absence scoped work shift viewers"
  ON public.employee_work_shifts
  FOR SELECT
  TO authenticated
  USING (public.can_actor_view_employee_work_shift(profile_id));

COMMIT;
