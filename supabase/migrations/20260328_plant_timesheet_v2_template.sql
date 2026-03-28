BEGIN;

ALTER TABLE public.timesheets
  ADD COLUMN IF NOT EXISTS template_version INTEGER,
  ADD COLUMN IF NOT EXISTS site_address TEXT,
  ADD COLUMN IF NOT EXISTS hirer_name TEXT,
  ADD COLUMN IF NOT EXISTS is_hired_plant BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS hired_plant_id_serial TEXT,
  ADD COLUMN IF NOT EXISTS hired_plant_description TEXT,
  ADD COLUMN IF NOT EXISTS hired_plant_hiring_company TEXT;

UPDATE public.timesheets
SET template_version = 1
WHERE template_version IS NULL;

ALTER TABLE public.timesheets
  ALTER COLUMN template_version SET DEFAULT 1,
  ALTER COLUMN template_version SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'timesheets_template_version_check'
  ) THEN
    ALTER TABLE public.timesheets
      ADD CONSTRAINT timesheets_template_version_check
      CHECK (template_version IN (1, 2));
  END IF;
END $$;

ALTER TABLE public.timesheet_entries
  ADD COLUMN IF NOT EXISTS operator_travel_hours NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS operator_yard_hours NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS operator_working_hours NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS machine_travel_hours NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS machine_start_time TIME,
  ADD COLUMN IF NOT EXISTS machine_finish_time TIME,
  ADD COLUMN IF NOT EXISTS machine_working_hours NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS machine_standing_hours NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS machine_operator_hours NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS maintenance_breakdown_hours NUMERIC(6,2);

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

COMMIT;
