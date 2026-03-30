BEGIN;

ALTER TABLE public.absences
ADD COLUMN IF NOT EXISTS allow_timesheet_work_on_leave BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.absences_archive
ADD COLUMN IF NOT EXISTS allow_timesheet_work_on_leave BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.archive_closed_financial_year_absences(
  p_financial_year_start_year INTEGER,
  p_archived_by UUID DEFAULT auth.uid(),
  p_notes TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_force BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  archive_run_id UUID,
  financial_year_start_year INTEGER,
  row_count INTEGER,
  skipped BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start_date DATE;
  v_end_date DATE;
  v_existing_run RECORD;
  v_run_id UUID;
  v_row_count INTEGER;
BEGIN
  v_start_date := make_date(p_financial_year_start_year, 4, 1);
  v_end_date := make_date(p_financial_year_start_year + 1, 3, 31);

  IF CURRENT_DATE <= v_end_date THEN
    RAISE EXCEPTION 'Financial year % is not closed yet', p_financial_year_start_year;
  END IF;

  SELECT id, row_count
  INTO v_existing_run
  FROM absence_financial_year_archives
  WHERE financial_year_start_year = p_financial_year_start_year
  ORDER BY archived_at DESC
  LIMIT 1;

  IF v_existing_run.id IS NOT NULL AND NOT p_force THEN
    RETURN QUERY
    SELECT v_existing_run.id, p_financial_year_start_year, v_existing_run.row_count, TRUE;
    RETURN;
  END IF;

  v_run_id := gen_random_uuid();

  PERFORM set_config('app.absence_archive_move', 'on', true);

  WITH moved_rows AS (
    INSERT INTO absences_archive (
      id,
      profile_id,
      date,
      end_date,
      reason_id,
      duration_days,
      is_half_day,
      half_day_session,
      notes,
      status,
      created_by,
      approved_by,
      approved_at,
      is_bank_holiday,
      auto_generated,
      generation_source,
      holiday_key,
      allow_timesheet_work_on_leave,
      created_at,
      updated_at,
      financial_year_start_year,
      archived_at,
      archived_by,
      archive_run_id
    )
    SELECT
      a.id,
      a.profile_id,
      a.date,
      a.end_date,
      a.reason_id,
      a.duration_days,
      a.is_half_day,
      a.half_day_session,
      a.notes,
      a.status,
      a.created_by,
      a.approved_by,
      a.approved_at,
      a.is_bank_holiday,
      a.auto_generated,
      a.generation_source,
      a.holiday_key,
      a.allow_timesheet_work_on_leave,
      a.created_at,
      a.updated_at,
      p_financial_year_start_year,
      NOW(),
      p_archived_by,
      v_run_id
    FROM absences a
    WHERE a.date >= v_start_date
      AND a.date <= v_end_date
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  ),
  deleted_rows AS (
    DELETE FROM absences
    WHERE id IN (SELECT id FROM moved_rows)
    RETURNING id
  )
  SELECT COUNT(*)::INTEGER
  INTO v_row_count
  FROM deleted_rows;

  INSERT INTO absence_financial_year_archives (
    id,
    financial_year_start_year,
    archived_at,
    archived_by,
    row_count,
    notes,
    idempotency_key
  )
  VALUES (
    v_run_id,
    p_financial_year_start_year,
    NOW(),
    p_archived_by,
    COALESCE(v_row_count, 0),
    p_notes,
    p_idempotency_key
  );

  RETURN QUERY
  SELECT v_run_id, p_financial_year_start_year, COALESCE(v_row_count, 0), FALSE;
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
    AND a.status = 'approved'
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

COMMIT;
