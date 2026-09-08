-- finalise-phase: predeploy
-- Date-scoped bank-holiday confirmation grant for timesheet hours.
-- Does not set Timesheet override on ordinary annual leave.

BEGIN;

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
    AND lower(trim(ar.name)) <> 'training'
    AND NOT (
      COALESCE(a.allow_timesheet_work_on_leave, false) = true
      AND lower(trim(ar.name)) = 'annual leave'
    )
    AND NOT (
      lower(trim(ar.name)) = 'annual leave'
      AND EXISTS (
        SELECT 1
        FROM public.timesheet_bank_holiday_work_confirmations c
        WHERE c.timesheet_id = NEW.timesheet_id
          AND c.work_date = v_entry_date
          AND c.absence_id = a.id
      )
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
  NEW.subsistence_payment_required := false;
  NEW.daily_total := CASE WHEN COALESCE(v_leave_is_paid, false) THEN 9 ELSE 0 END;
  NEW.night_shift := false;
  NEW.bank_holiday := false;
  NEW.remarks := v_leave_reason;
  NEW.operator_travel_hours := NULL;
  NEW.operator_yard_hours := NULL;
  NEW.operator_working_hours := NULL;
  NEW.machine_travel_hours := NULL;
  NEW.machine_start_time := NULL;
  NEW.machine_finish_time := NULL;
  NEW.machine_working_hours := NULL;
  NEW.machine_standing_hours := NULL;
  NEW.machine_operator_hours := NULL;
  NEW.maintenance_breakdown_hours := NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS timesheet_entries_enforce_absence_rules ON public.timesheet_entries;
CREATE TRIGGER timesheet_entries_enforce_absence_rules
BEFORE INSERT OR UPDATE ON public.timesheet_entries
FOR EACH ROW
EXECUTE FUNCTION public.enforce_timesheet_entry_absence_rules();

COMMIT;
