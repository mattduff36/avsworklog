-- finalise-phase: predeploy
-- Keep-data user deletion: durable deleted_at tombstone, absence write guard,
-- and service-role cleanup of open-year annual leave.

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

UPDATE public.profiles
SET deleted_at = COALESCE(updated_at, created_at, NOW())
WHERE deleted_at IS NULL
  AND (
    full_name = '(Deleted User)'
    OR full_name LIKE '% (Deleted User)'
  );

DO $$
DECLARE
  v_reason_count integer;
  v_reason_id uuid;
BEGIN
  v_reason_count := 0;
  v_reason_id := NULL;

  SELECT s.id, s.reason_count
  INTO v_reason_id, v_reason_count
  FROM (
    SELECT id, COUNT(*) OVER () AS reason_count
    FROM public.absence_reasons
    WHERE lower(trim(name)) = 'annual leave'
  ) s
  LIMIT 1;

  IF v_reason_count <> 1 OR v_reason_id IS NULL THEN
    RAISE EXCEPTION 'Annual leave reason is missing or ambiguous';
  END IF;

  PERFORM set_config('app.absence_historic_delete_bypass', 'on', true);

  DELETE FROM public.absences
  WHERE reason_id = v_reason_id
    AND NOT public.absence_is_closed_financial_year(date)
    AND profile_id IN (
      SELECT id
      FROM public.profiles
      WHERE deleted_at IS NOT NULL
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_profile_deleted_at_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.deleted_at IS NOT NULL THEN
    NEW.deleted_at := OLD.deleted_at;
    RETURN NEW;
  END IF;

  IF NEW.deleted_at IS NOT NULL AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Only service_role can mark a profile as deleted'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profile_deleted_at_immutability ON public.profiles;
CREATE TRIGGER trg_guard_profile_deleted_at_immutability
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_deleted_at_immutability();

CREATE OR REPLACE FUNCTION public.guard_absence_deleted_profile_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted_at timestamptz;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.profile_id IS NOT DISTINCT FROM OLD.profile_id THEN
    RETURN NEW;
  END IF;

  -- Row share lock conflicts with the tombstone UPDATE of deleted_at.
  -- Key-share is too weak. Stronger exclusive row locks over-serialize unrelated writes.
  SELECT p.deleted_at
    INTO v_deleted_at
    FROM public.profiles p
   WHERE p.id = NEW.profile_id
   FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cannot create or reassign absences for a missing profile'
      USING ERRCODE = '42501';
  END IF;

  IF v_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot create or reassign absences for a deleted profile'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_absence_deleted_profile_write ON public.absences;
CREATE TRIGGER trg_guard_absence_deleted_profile_write
  BEFORE INSERT OR UPDATE OF profile_id ON public.absences
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_absence_deleted_profile_write();

CREATE OR REPLACE FUNCTION public.delete_profile_open_year_annual_leave_bookings(p_profile_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reason_id uuid;
  v_reason_count integer;
  v_removed integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Forbidden: service_role required'
      USING ERRCODE = '42501';
  END IF;

  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'profile id is required';
  END IF;

  v_reason_count := 0;
  v_reason_id := NULL;

  SELECT s.id, s.reason_count
  INTO v_reason_id, v_reason_count
  FROM (
    SELECT id, COUNT(*) OVER () AS reason_count
    FROM public.absence_reasons
    WHERE lower(trim(name)) = 'annual leave'
  ) s
  LIMIT 1;

  IF v_reason_count <> 1 OR v_reason_id IS NULL THEN
    RAISE EXCEPTION 'Annual leave reason is missing or ambiguous';
  END IF;

  PERFORM set_config('app.absence_historic_delete_bypass', 'on', true);

  DELETE FROM public.absences
  WHERE profile_id = p_profile_id
    AND reason_id = v_reason_id
    AND NOT public.absence_is_closed_financial_year(date);

  GET DIAGNOSTICS v_removed = ROW_COUNT;
  RETURN v_removed;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_profile_open_year_annual_leave_bookings(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_profile_open_year_annual_leave_bookings(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.delete_profile_open_year_annual_leave_bookings(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.delete_profile_open_year_annual_leave_bookings(uuid) TO service_role;

COMMIT;
