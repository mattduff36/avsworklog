-- finalise-phase: predeploy
-- Bank holiday self-override trial: settings, trusted confirmations,
-- absence provenance hardening, and complete leave-lock coercion.

BEGIN;

CREATE TABLE IF NOT EXISTS public.timesheet_module_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
  bank_holiday_self_override_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.timesheet_module_settings IS
  'Singleton timesheet module settings. Trial flag defaults ON.';

COMMENT ON COLUMN public.timesheet_module_settings.bank_holiday_self_override_enabled IS
  'When true, employees may confirm bank-holiday hours after typing BANK HOLIDAY.';

INSERT INTO public.timesheet_module_settings (id, bank_holiday_self_override_enabled)
VALUES (TRUE, TRUE)
ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS timesheet_module_settings_updated_at_trigger
  ON public.timesheet_module_settings;
CREATE TRIGGER timesheet_module_settings_updated_at_trigger
BEFORE UPDATE ON public.timesheet_module_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.timesheet_module_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS timesheet_module_settings_select ON public.timesheet_module_settings;
CREATE POLICY timesheet_module_settings_select
  ON public.timesheet_module_settings
  FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE TABLE IF NOT EXISTS public.timesheet_bank_holiday_work_confirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timesheet_id UUID NOT NULL REFERENCES public.timesheets(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  absence_id UUID NOT NULL REFERENCES public.absences(id) ON DELETE RESTRICT,
  confirmed_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (timesheet_id, work_date)
);

COMMENT ON TABLE public.timesheet_bank_holiday_work_confirmations IS
  'Server-only evidence that BANK HOLIDAY was typed for a timesheet date. Authenticated clients cannot write this table.';

CREATE INDEX IF NOT EXISTS timesheet_bank_holiday_work_confirmations_timesheet_idx
  ON public.timesheet_bank_holiday_work_confirmations (timesheet_id);

ALTER TABLE public.timesheet_bank_holiday_work_confirmations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS timesheet_bank_holiday_work_confirmations_select
  ON public.timesheet_bank_holiday_work_confirmations;
CREATE POLICY timesheet_bank_holiday_work_confirmations_select
  ON public.timesheet_bank_holiday_work_confirmations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.timesheets t
      WHERE t.id = timesheet_id
        AND (
          t.user_id = (SELECT auth.uid())
          OR public.is_actor_admin((SELECT auth.uid()))
          OR public.effective_is_manager_admin()
        )
    )
  );

CREATE OR REPLACE FUNCTION public.enforce_absence_bank_holiday_provenance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_can_manage BOOLEAN;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RETURN NEW;
  END IF;

  v_can_manage := public.is_actor_admin(v_actor)
    OR public.can_actor_edit_absence_request(v_actor, NEW.profile_id);

  IF TG_OP = 'INSERT' THEN
    IF NOT v_can_manage THEN
      IF COALESCE(NEW.is_bank_holiday, false)
        OR COALESCE(NEW.auto_generated, false)
        OR NEW.holiday_key IS NOT NULL
        OR COALESCE(NEW.allow_timesheet_work_on_leave, false)
      THEN
        RAISE EXCEPTION 'Not authorised to create bank-holiday provenance or timesheet override'
          USING ERRCODE = '42501';
      END IF;
    ELSIF NOT public.is_actor_admin(v_actor) THEN
      IF COALESCE(NEW.is_bank_holiday, false)
        OR COALESCE(NEW.auto_generated, false)
        OR NEW.holiday_key IS NOT NULL
      THEN
        RAISE EXCEPTION 'Not authorised to create bank-holiday provenance'
          USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NOT v_can_manage THEN
    IF NEW.is_bank_holiday IS DISTINCT FROM OLD.is_bank_holiday
      OR NEW.auto_generated IS DISTINCT FROM OLD.auto_generated
      OR NEW.holiday_key IS DISTINCT FROM OLD.holiday_key
      OR NEW.allow_timesheet_work_on_leave IS DISTINCT FROM OLD.allow_timesheet_work_on_leave
    THEN
      RAISE EXCEPTION 'Not authorised to change bank-holiday provenance or timesheet override'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NOT public.is_actor_admin(v_actor) THEN
    IF NEW.is_bank_holiday IS DISTINCT FROM OLD.is_bank_holiday
      OR NEW.auto_generated IS DISTINCT FROM OLD.auto_generated
      OR NEW.holiday_key IS DISTINCT FROM OLD.holiday_key
    THEN
      RAISE EXCEPTION 'Not authorised to change bank-holiday provenance'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_absence_bank_holiday_provenance ON public.absences;
CREATE TRIGGER trg_enforce_absence_bank_holiday_provenance
  BEFORE INSERT OR UPDATE OF is_bank_holiday, auto_generated, holiday_key, allow_timesheet_work_on_leave
  ON public.absences
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_absence_bank_holiday_provenance();

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

COMMIT;
