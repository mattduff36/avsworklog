BEGIN;

-- Resolve a timesheet entry date from week_ending + day_of_week (1=Mon, 7=Sun).
CREATE OR REPLACE FUNCTION public.resolve_timesheet_entry_date(
  p_week_ending DATE,
  p_day_of_week INTEGER
)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (p_week_ending - (7 - GREATEST(1, LEAST(7, p_day_of_week))))::date
$$;

-- Enforce approved full-day leave to always persist as "did not work".
-- This protects integrity even if a client bypasses UI constraints.
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
BEGIN
  SELECT t.user_id, t.week_ending
  INTO v_profile_id, v_week_ending
  FROM public.timesheets t
  WHERE t.id = NEW.timesheet_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_entry_date := public.resolve_timesheet_entry_date(v_week_ending, NEW.day_of_week);

  SELECT ar.name
  INTO v_leave_reason
  FROM public.absences a
  JOIN public.absence_reasons ar ON ar.id = a.reason_id
  WHERE a.profile_id = v_profile_id
    AND a.status = 'approved'
    AND COALESCE(a.is_half_day, false) = false
    AND a.date <= v_entry_date
    AND COALESCE(a.end_date, a.date) >= v_entry_date
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
  NEW.daily_total := 0;
  NEW.night_shift := false;
  NEW.bank_holiday := false;
  NEW.remarks := v_leave_reason;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS timesheet_entries_enforce_absence_rules ON public.timesheet_entries;

CREATE TRIGGER timesheet_entries_enforce_absence_rules
BEFORE INSERT OR UPDATE ON public.timesheet_entries
FOR EACH ROW
EXECUTE FUNCTION public.enforce_timesheet_entry_absence_rules();

COMMIT;
