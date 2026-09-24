-- finalise-phase: predeploy
-- Safely convert an existing profile to Contractor in one database transaction.

BEGIN;

CREATE OR REPLACE FUNCTION public.guard_contractor_role_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_is_contractor boolean := false;
  v_new_is_contractor boolean := false;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old_is_contractor := lower(trim(COALESCE(OLD.name, ''))) = 'contractor';
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new_is_contractor := lower(trim(COALESCE(NEW.name, ''))) = 'contractor';
  END IF;

  IF TG_OP = 'DELETE' AND v_old_is_contractor THEN
    RAISE EXCEPTION 'The canonical Contractor role cannot be deleted'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' AND v_old_is_contractor IS DISTINCT FROM v_new_is_contractor THEN
    RAISE EXCEPTION 'The canonical Contractor role identity cannot be renamed or reassigned'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP <> 'DELETE'
    AND lower(trim(COALESCE(NEW.display_name, ''))) = 'contractor'
    AND NOT v_new_is_contractor
  THEN
    RAISE EXCEPTION 'Only the canonical Contractor role may use the Contractor display name'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_contractor_role_identity ON public.roles;
CREATE TRIGGER trg_guard_contractor_role_identity
  BEFORE INSERT OR UPDATE OR DELETE ON public.roles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_contractor_role_identity();

CREATE OR REPLACE FUNCTION public.guard_contractor_role_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.role_id IS NOT DISTINCT FROM OLD.role_id THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.roles r
     WHERE r.id = NEW.role_id
       AND lower(trim(COALESCE(r.name, ''))) = 'contractor'
  ) AND COALESCE(
    current_setting('app.contractor_role_transition', true),
    ''
  ) <> 'on' THEN
    RAISE EXCEPTION 'Contractor role changes require the dedicated transition'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_contractor_role_transition ON public.profiles;
CREATE TRIGGER trg_guard_contractor_role_transition
  BEFORE UPDATE OF role_id ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_contractor_role_transition();

CREATE OR REPLACE FUNCTION public.guard_leave_snapshot_absence_exists()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- This lock serializes snapshot creation against Contractor-transition
  -- deletion. Existing historic orphan rows remain untouched.
  PERFORM 1
    FROM public.absences a
   WHERE a.id = NEW.absence_id
   FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cannot create a leave snapshot for a missing absence'
      USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_leave_snapshot_absence_exists
  ON public.timesheet_entry_leave_snapshots;
CREATE TRIGGER trg_guard_leave_snapshot_absence_exists
  BEFORE INSERT OR UPDATE OF absence_id
  ON public.timesheet_entry_leave_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_leave_snapshot_absence_exists();

CREATE OR REPLACE FUNCTION public.transition_profile_to_contractor(
  p_profile_id uuid,
  p_expected_role_id uuid,
  p_contractor_role_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current_role_id uuid;
  v_deleted_at timestamptz;
  v_is_system_account boolean;
  v_target_role_name text;
  v_annual_leave_reason_id uuid;
  v_annual_leave_reason_count integer := 0;
  v_current_financial_year_start integer;
  v_blocking_leave_count integer := 0;
  v_removed_absence_count integer := 0;
  v_zeroed_carryover_count integer := 0;
  v_cleared_permission_count integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Forbidden: service_role required'
      USING ERRCODE = '42501';
  END IF;

  IF p_profile_id IS NULL
    OR p_expected_role_id IS NULL
    OR p_contractor_role_id IS NULL
  THEN
    RAISE EXCEPTION 'Profile, expected role, and Contractor role are required'
      USING ERRCODE = '22004';
  END IF;

  SELECT p.role_id, p.deleted_at, COALESCE(p.is_system_account, false)
    INTO v_current_role_id, v_deleted_at, v_is_system_account
    FROM public.profiles p
   WHERE p.id = p_profile_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contractor transition blocked: profile not found'
      USING ERRCODE = 'P0001', DETAIL = 'PROFILE_NOT_FOUND';
  END IF;

  IF v_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Contractor transition blocked: deleted profiles cannot be converted'
      USING ERRCODE = 'P0001', DETAIL = 'PROFILE_DELETED';
  END IF;

  IF v_is_system_account THEN
    RAISE EXCEPTION 'Contractor transition blocked: system accounts cannot be converted'
      USING ERRCODE = 'P0001', DETAIL = 'SYSTEM_ACCOUNT';
  END IF;

  IF v_current_role_id IS DISTINCT FROM p_expected_role_id THEN
    RAISE EXCEPTION 'Contractor transition blocked: the profile role changed; refresh and try again'
      USING ERRCODE = 'P0001', DETAIL = 'STALE_ROLE';
  END IF;

  IF v_current_role_id = p_contractor_role_id THEN
    RAISE EXCEPTION 'Contractor transition blocked: profile is already a Contractor'
      USING ERRCODE = 'P0001', DETAIL = 'ALREADY_CONTRACTOR';
  END IF;

  SELECT r.name
    INTO v_target_role_name
    FROM public.roles r
   WHERE r.id = p_contractor_role_id
   FOR SHARE;

  IF NOT FOUND
    OR lower(trim(COALESCE(v_target_role_name, ''))) <> 'contractor'
  THEN
    RAISE EXCEPTION 'Contractor transition blocked: target role is not Contractor'
      USING ERRCODE = 'P0001', DETAIL = 'INVALID_TARGET_ROLE';
  END IF;

  SELECT s.id, s.reason_count
    INTO v_annual_leave_reason_id, v_annual_leave_reason_count
    FROM (
      SELECT ar.id, COUNT(*) OVER () AS reason_count
        FROM public.absence_reasons ar
       WHERE lower(trim(ar.name)) = 'annual leave'
    ) s
   LIMIT 1;

  IF v_annual_leave_reason_count <> 1 OR v_annual_leave_reason_id IS NULL THEN
    RAISE EXCEPTION 'Contractor transition blocked: Annual Leave reason is missing or ambiguous'
      USING ERRCODE = 'P0001', DETAIL = 'ANNUAL_LEAVE_REASON_INVALID';
  END IF;

  v_current_financial_year_start :=
    public.absence_financial_year_start_year(CURRENT_DATE);

  -- Lock every row whose value or existence the transition will inspect or change.
  PERFORM 1
    FROM public.absence_allowance_carryovers c
   WHERE c.profile_id = p_profile_id
     AND c.financial_year_start_year = v_current_financial_year_start
   FOR UPDATE;

  PERFORM 1
    FROM public.user_module_permissions ump
   WHERE ump.user_id = p_profile_id
   FOR UPDATE;

  PERFORM 1
    FROM public.absences a
   WHERE a.profile_id = p_profile_id
     AND a.reason_id = v_annual_leave_reason_id
     AND NOT public.absence_is_closed_financial_year(a.date)
   FOR UPDATE;

  -- Future automation can be safely removed. Every other open-year Annual
  -- Leave row is preserved and blocks the conversion for manual review.
  SELECT COUNT(*)::integer
    INTO v_blocking_leave_count
    FROM public.absences a
   WHERE a.profile_id = p_profile_id
     AND a.reason_id = v_annual_leave_reason_id
     AND NOT public.absence_is_closed_financial_year(a.date)
     AND NOT (
       a.date > CURRENT_DATE
       AND (
         (COALESCE(a.auto_generated, false) AND COALESCE(a.is_bank_holiday, false))
         OR a.bulk_batch_id IS NOT NULL
       )
     );

  IF v_blocking_leave_count > 0 THEN
    RAISE EXCEPTION
      'Contractor transition blocked: % open-year Annual Leave booking(s) require manual review',
      v_blocking_leave_count
      USING ERRCODE = 'P0001', DETAIL = 'AMBIGUOUS_ANNUAL_LEAVE';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.timesheet_entry_leave_snapshots snapshot
      JOIN public.absences a ON a.id = snapshot.absence_id
     WHERE a.profile_id = p_profile_id
       AND a.reason_id = v_annual_leave_reason_id
       AND NOT public.absence_is_closed_financial_year(a.date)
  ) OR EXISTS (
    SELECT 1
      FROM public.timesheet_bank_holiday_work_confirmations confirmation
      JOIN public.absences a ON a.id = confirmation.absence_id
     WHERE a.profile_id = p_profile_id
       AND a.reason_id = v_annual_leave_reason_id
       AND NOT public.absence_is_closed_financial_year(a.date)
  ) THEN
    RAISE EXCEPTION
      'Contractor transition blocked: Annual Leave has linked timesheet evidence'
      USING ERRCODE = 'P0001', DETAIL = 'TIMESHEET_EVIDENCE';
  END IF;

  PERFORM set_config('app.absence_historic_delete_bypass', 'on', true);

  DELETE FROM public.absences a
   WHERE a.profile_id = p_profile_id
     AND a.reason_id = v_annual_leave_reason_id
     AND NOT public.absence_is_closed_financial_year(a.date)
     AND a.date > CURRENT_DATE
     AND (
       (COALESCE(a.auto_generated, false) AND COALESCE(a.is_bank_holiday, false))
       OR a.bulk_batch_id IS NOT NULL
     );
  GET DIAGNOSTICS v_removed_absence_count = ROW_COUNT;

  UPDATE public.absence_allowance_carryovers c
     SET carried_days = 0,
         updated_at = NOW()
   WHERE c.profile_id = p_profile_id
     AND c.financial_year_start_year = v_current_financial_year_start
     AND c.carried_days IS DISTINCT FROM 0;
  GET DIAGNOSTICS v_zeroed_carryover_count = ROW_COUNT;

  DELETE FROM public.user_module_permissions ump
   WHERE ump.user_id = p_profile_id;
  GET DIAGNOSTICS v_cleared_permission_count = ROW_COUNT;

  PERFORM set_config('app.contractor_role_transition', 'on', true);

  UPDATE public.profiles
     SET role_id = p_contractor_role_id,
         annual_holiday_allowance_days = 0,
         updated_at = NOW()
   WHERE id = p_profile_id;

  RETURN jsonb_build_object(
    'profileId', p_profile_id,
    'previousRoleId', v_current_role_id,
    'contractorRoleId', p_contractor_role_id,
    'removedAbsenceCount', v_removed_absence_count,
    'zeroedCarryoverCount', v_zeroed_carryover_count,
    'clearedPermissionCount', v_cleared_permission_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.transition_profile_to_contractor(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transition_profile_to_contractor(uuid, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.transition_profile_to_contractor(uuid, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.transition_profile_to_contractor(uuid, uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.guard_contractor_role_identity() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_contractor_role_transition() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_leave_snapshot_absence_exists() FROM PUBLIC;

COMMIT;
