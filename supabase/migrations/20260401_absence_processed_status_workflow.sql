BEGIN;

ALTER TABLE public.absences
  ADD COLUMN IF NOT EXISTS processed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

ALTER TABLE public.absences_archive
  ADD COLUMN IF NOT EXISTS processed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

ALTER TABLE public.absences
  DROP CONSTRAINT IF EXISTS absences_status_check;

ALTER TABLE public.absences
  ADD CONSTRAINT absences_status_check
  CHECK (status IN ('pending', 'approved', 'processed', 'rejected', 'cancelled'));

ALTER TABLE public.absences_archive
  DROP CONSTRAINT IF EXISTS absences_archive_status_check;

ALTER TABLE public.absences_archive
  ADD CONSTRAINT absences_archive_status_check
  CHECK (status IN ('pending', 'approved', 'processed', 'rejected', 'cancelled'));

CREATE OR REPLACE FUNCTION public.validate_absence_conflict()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  new_start DATE;
  new_end DATE;
  existing_row RECORD;
  existing_start DATE;
  existing_end DATE;
BEGIN
  IF NEW.status NOT IN ('approved', 'processed', 'pending') THEN
    RETURN NEW;
  END IF;

  new_start := NEW.date;
  new_end := COALESCE(NEW.end_date, NEW.date);

  IF NEW.is_half_day = TRUE AND NEW.half_day_session IS NULL THEN
    RAISE EXCEPTION 'Half-day absences require a half-day session (AM/PM)';
  END IF;

  IF NEW.is_half_day = TRUE AND new_end <> new_start THEN
    RAISE EXCEPTION 'Half-day absences must be single-day entries';
  END IF;

  FOR existing_row IN
    SELECT
      id,
      date,
      end_date,
      is_half_day,
      half_day_session
    FROM absences
    WHERE profile_id = NEW.profile_id
      AND status IN ('approved', 'processed', 'pending')
      AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND daterange(date, COALESCE(end_date, date), '[]')
        && daterange(new_start, new_end, '[]')
  LOOP
    existing_start := existing_row.date;
    existing_end := COALESCE(existing_row.end_date, existing_row.date);

    IF NEW.is_half_day = FALSE THEN
      RAISE EXCEPTION 'Absence conflict for profile % on % to %', NEW.profile_id, new_start, new_end;
    END IF;

    IF existing_start <> new_start OR existing_end <> new_start THEN
      RAISE EXCEPTION 'Half-day absence conflicts with existing multi-day or different-day absence';
    END IF;

    IF existing_row.is_half_day = FALSE THEN
      RAISE EXCEPTION 'Half-day absence conflicts with existing full-day absence';
    END IF;

    IF existing_row.half_day_session = NEW.half_day_session THEN
      RAISE EXCEPTION 'Half-day absence conflicts with existing % booking on %', NEW.half_day_session, new_start;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_timesheet_entry_absence_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id UUID;
  v_week_ending DATE;
  v_entry_date DATE;
  v_leave_reason TEXT;
  v_leave_is_paid BOOLEAN;
BEGIN
  SELECT t.user_id, t.week_ending
  INTO v_profile_id, v_week_ending
  FROM public.timesheets t
  WHERE t.id = NEW.timesheet_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_entry_date := public.resolve_timesheet_entry_date(v_week_ending, NEW.day_of_week);

  SELECT ar.name, ar.is_paid
  INTO v_leave_reason, v_leave_is_paid
  FROM public.absences a
  JOIN public.absence_reasons ar ON ar.id = a.reason_id
  WHERE a.profile_id = v_profile_id
    AND a.status IN ('approved', 'processed')
    AND COALESCE(a.is_half_day, false) = false
    AND a.date <= v_entry_date
    AND COALESCE(a.end_date, a.date) >= v_entry_date
    AND NOT (
      COALESCE(a.allow_timesheet_work_on_leave, false) = true
      AND lower(trim(ar.name)) = 'annual leave'
    )
  ORDER BY a.date DESC, a.created_at DESC
  LIMIT 1;

  IF v_leave_reason IS NULL THEN
    RETURN NEW;
  END IF;

  NEW.did_not_work := true;
  NEW.time_started := NULL;
  NEW.time_finished := NULL;
  NEW.job_number := NULL;
  NEW.working_in_yard := false;
  NEW.daily_total := CASE WHEN COALESCE(v_leave_is_paid, false) THEN 9 ELSE 0 END;
  NEW.night_shift := false;
  NEW.bank_holiday := false;
  NEW.remarks := v_leave_reason;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.recalculate_financial_year_carryover_for_profile(
  p_source_financial_year_start_year INTEGER,
  p_profile_id UUID,
  p_actor_profile_id UUID DEFAULT auth.uid()
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_annual_leave_reason_id UUID;
  v_base_allowance NUMERIC;
  v_source_carry_in NUMERIC;
  v_approved_days NUMERIC;
  v_target_financial_year_start_year INTEGER;
  v_carryover_days NUMERIC;
  v_start_date DATE;
  v_end_date DATE;
BEGIN
  v_target_financial_year_start_year := p_source_financial_year_start_year + 1;
  v_start_date := make_date(p_source_financial_year_start_year, 4, 1);
  v_end_date := make_date(p_source_financial_year_start_year + 1, 3, 31);

  SELECT id
  INTO v_annual_leave_reason_id
  FROM absence_reasons
  WHERE lower(name) = 'annual leave'
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_annual_leave_reason_id IS NULL THEN
    RAISE EXCEPTION 'Annual leave reason not found';
  END IF;

  SELECT COALESCE(annual_holiday_allowance_days, 28)
  INTO v_base_allowance
  FROM profiles
  WHERE id = p_profile_id;

  IF v_base_allowance IS NULL THEN
    v_base_allowance := 28;
  END IF;

  SELECT COALESCE(carried_days, 0)
  INTO v_source_carry_in
  FROM absence_allowance_carryovers
  WHERE profile_id = p_profile_id
    AND financial_year_start_year = p_source_financial_year_start_year;

  IF v_source_carry_in IS NULL THEN
    v_source_carry_in := 0;
  END IF;

  SELECT COALESCE(SUM(a.duration_days), 0)
  INTO v_approved_days
  FROM absences a
  WHERE a.profile_id = p_profile_id
    AND a.reason_id = v_annual_leave_reason_id
    AND a.status IN ('approved', 'processed')
    AND a.date >= v_start_date
    AND a.date <= v_end_date;

  IF v_approved_days IS NULL THEN
    v_approved_days := 0;
  END IF;

  v_carryover_days := (v_base_allowance + v_source_carry_in) - v_approved_days;

  IF v_carryover_days = 0 THEN
    DELETE FROM absence_allowance_carryovers
    WHERE profile_id = p_profile_id
      AND financial_year_start_year = v_target_financial_year_start_year;
    RETURN 0;
  END IF;

  INSERT INTO absence_allowance_carryovers (
    profile_id,
    financial_year_start_year,
    source_financial_year_start_year,
    carried_days,
    auto_generated,
    generation_source,
    generated_at,
    generated_by
  )
  VALUES (
    p_profile_id,
    v_target_financial_year_start_year,
    p_source_financial_year_start_year,
    v_carryover_days,
    true,
    'absence-year-end-carryover',
    NOW(),
    p_actor_profile_id
  )
  ON CONFLICT (profile_id, financial_year_start_year)
  DO UPDATE SET
    source_financial_year_start_year = EXCLUDED.source_financial_year_start_year,
    carried_days = EXCLUDED.carried_days,
    auto_generated = true,
    generation_source = EXCLUDED.generation_source,
    generated_at = EXCLUDED.generated_at,
    generated_by = EXCLUDED.generated_by,
    updated_at = NOW();

  RETURN v_carryover_days;
END;
$$;

UPDATE public.absences
SET
  processed_by = COALESCE(processed_by, approved_by),
  processed_at = COALESCE(processed_at, approved_at)
WHERE status = 'processed';

UPDATE public.absences_archive
SET
  processed_by = COALESCE(processed_by, approved_by),
  processed_at = COALESCE(processed_at, approved_at)
WHERE status = 'processed';

COMMIT;
