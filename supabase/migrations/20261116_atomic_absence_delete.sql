-- finalise-phase: predeploy
-- Single-booking deletion only. Existing archive/bulk/year-setup paths are unchanged.
BEGIN;

CREATE OR REPLACE FUNCTION public.reconcile_deleted_absence_timesheets()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
  v_timesheet public.timesheets%ROWTYPE;
  v_entry public.timesheet_entries%ROWTYPE;
  v_original public.timesheet_entries%ROWTYPE;
  v_snapshot public.timesheet_entry_leave_snapshots%ROWTYPE;
  v_reason text;
  v_paid boolean;
  v_remark text;
  v_jobs text[];
  v_expected_jobs text[];
  v_has_snapshots boolean;
  v_has_snapshot boolean;
  v_active boolean := OLD.status IN ('approved', 'processed');
  v_expected jsonb;
BEGIN
  -- The invoker RPC supplies no extra delete authority: its DELETE still uses RLS.
  -- Scope the privileged reconciliation to that one transaction and booking.
  IF current_setting('app.absence_delete_timesheet_effects', true) IS DISTINCT FROM OLD.id::text THEN
    RETURN OLD;
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF OLD.profile_id <> auth.uid()
     AND NOT COALESCE(public.can_actor_authorise_timesheet(OLD.profile_id), false) THEN
    RAISE EXCEPTION 'You cannot change this employee''s timesheet hours' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(OLD.is_bank_holiday, false) OR COALESCE(OLD.auto_generated, false) THEN
    RAISE EXCEPTION 'Bank holidays and auto-generated absences cannot be deleted individually';
  END IF;
  IF OLD.bulk_batch_id IS NOT NULL AND NOT COALESCE(public.effective_is_admin(), false) THEN
    RAISE EXCEPTION 'Bulk company leave bookings can only be removed by an admin or via Undo Bulk Booking';
  END IF;
  IF public.is_absence_financial_year_closed(public.absence_financial_year_start_year(OLD.date))
     AND NOT COALESCE(public.effective_is_manager_admin() OR public.effective_is_admin(), false) THEN
    RAISE EXCEPTION 'This financial year is closed for employee bookings. Please contact your manager.';
  END IF;

  -- Row locks alone miss newly inserted sheets/entries. Serialize the rare
  -- deletion with writers before taking fresh READ COMMITTED snapshots.
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Absence deletion requires read committed isolation' USING ERRCODE = '25000';
  END IF;
  LOCK TABLE public.absences, public.timesheets, public.timesheet_entries,
    public.timesheet_entry_job_codes, public.timesheet_entry_leave_snapshots
    IN SHARE ROW EXCLUSIVE MODE;

  SELECT EXISTS (
    SELECT 1 FROM public.timesheet_entry_leave_snapshots WHERE absence_id = OLD.id
  ) INTO v_has_snapshots;
  IF NOT v_active AND NOT v_has_snapshots THEN
    RETURN OLD;
  END IF;

  SELECT name, is_paid INTO STRICT v_reason, v_paid
  FROM public.absence_reasons WHERE id = OLD.reason_id;
  v_remark := COALESCE(v_reason, 'Leave') ||
    CASE WHEN OLD.half_day_session IS NULL THEN '' ELSE ' (' || OLD.half_day_session || ')' END;

  -- Entry/job-code guards take a parent FOR SHARE lock. FOR UPDATE serializes
  -- reconciliation with those writers and with payroll/status transitions.
  FOR v_timesheet IN
    SELECT t.* FROM public.timesheets t
    WHERE (v_active AND t.user_id = OLD.profile_id
      AND t.week_ending BETWEEN
        OLD.date + (7 - extract(isodow FROM OLD.date)::integer)
        AND (CASE WHEN OLD.is_half_day THEN OLD.date ELSE COALESCE(OLD.end_date, OLD.date) END)
          + (7 - extract(isodow FROM CASE WHEN OLD.is_half_day THEN OLD.date ELSE COALESCE(OLD.end_date, OLD.date) END)::integer))
      OR t.id IN (SELECT timesheet_id FROM public.timesheet_entry_leave_snapshots WHERE absence_id = OLD.id)
    ORDER BY t.id
    FOR UPDATE OF t
  LOOP
    IF v_timesheet.user_id <> OLD.profile_id THEN
      RAISE EXCEPTION 'Leave snapshot no longer matches this booking. Refresh and try again.' USING ERRCODE = '40001';
    END IF;
    IF v_timesheet.status IS NULL OR v_timesheet.status NOT IN ('draft', 'rejected', 'submitted', 'manager_approved') THEN
      RAISE EXCEPTION 'This leave booking affects locked timesheets and cannot be changed: % (%)',
        v_timesheet.week_ending, v_timesheet.status;
    END IF;
  END LOOP;

  -- Lock snapshots before reading their restoration evidence.
  PERFORM 1 FROM public.timesheet_entry_leave_snapshots
  WHERE absence_id = OLD.id ORDER BY id FOR UPDATE;

  FOR v_entry IN
    SELECT e.* FROM public.timesheet_entries e
    JOIN public.timesheets t ON t.id = e.timesheet_id
    WHERE (v_active AND t.user_id = OLD.profile_id
      AND (t.week_ending - (7 - GREATEST(1, LEAST(7, e.day_of_week))))
        BETWEEN OLD.date AND CASE WHEN OLD.is_half_day THEN OLD.date ELSE COALESCE(OLD.end_date, OLD.date) END)
      OR e.id IN (SELECT timesheet_entry_id FROM public.timesheet_entry_leave_snapshots WHERE absence_id = OLD.id)
    ORDER BY e.timesheet_id, e.id
    FOR UPDATE OF e
  LOOP
    -- Recheck snapshot-referenced parents in case the evidence changed while
    -- the initial ordered parent lock was waiting.
    SELECT * INTO STRICT v_timesheet FROM public.timesheets WHERE id = v_entry.timesheet_id FOR UPDATE;
    IF v_timesheet.user_id <> OLD.profile_id THEN
      RAISE EXCEPTION 'Leave snapshot no longer matches this booking. Refresh and try again.' USING ERRCODE = '40001';
    END IF;
    IF v_timesheet.status IS NULL OR v_timesheet.status NOT IN ('draft', 'rejected', 'submitted', 'manager_approved') THEN
      RAISE EXCEPTION 'This leave booking affects locked timesheets and cannot be changed: % (%)',
        v_timesheet.week_ending, v_timesheet.status;
    END IF;
    SELECT * INTO v_snapshot FROM public.timesheet_entry_leave_snapshots
    WHERE absence_id = OLD.id AND timesheet_entry_id = v_entry.id;
    v_has_snapshot := FOUND;
    SELECT COALESCE(array_agg(job_number ORDER BY display_order), '{}'::text[]) INTO v_jobs
    FROM public.timesheet_entry_job_codes WHERE timesheet_entry_id = v_entry.id;
    IF cardinality(v_jobs) = 0 AND nullif(trim(v_entry.job_number), '') IS NOT NULL THEN
      v_jobs := ARRAY[trim(v_entry.job_number)];
    END IF;

    IF v_has_snapshot THEN
      IF v_snapshot.timesheet_id <> v_entry.timesheet_id OR v_snapshot.day_of_week <> v_entry.day_of_week
         OR EXISTS (SELECT 1 FROM public.timesheet_entry_leave_snapshots
           WHERE timesheet_entry_id = v_entry.id AND absence_id <> OLD.id) THEN
        RAISE EXCEPTION 'Leave snapshot no longer matches this booking. Refresh and try again.' USING ERRCODE = '40001';
      END IF;
      IF jsonb_typeof(v_snapshot.applied_entry) IS DISTINCT FROM 'object'
         OR NOT (v_snapshot.applied_entry ?& ARRAY['did_not_work', 'daily_total', 'remarks'])
         OR (v_snapshot.had_entry AND (
           jsonb_typeof(v_snapshot.original_entry) IS DISTINCT FROM 'object'
           OR NOT (v_snapshot.original_entry ?& ARRAY[
             'time_started', 'time_finished', 'job_number', 'working_in_yard', 'did_not_work',
             'daily_total', 'remarks', 'night_shift', 'bank_holiday', 'operator_travel_hours',
             'operator_yard_hours', 'operator_working_hours', 'machine_travel_hours',
             'machine_start_time', 'machine_finish_time', 'machine_working_hours',
             'machine_standing_hours', 'machine_operator_hours', 'maintenance_breakdown_hours'
           ]))) THEN
        RAISE EXCEPTION 'Leave restoration evidence is incomplete; no changes were made' USING ERRCODE = '40001';
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.absences a JOIN public.absence_reasons r ON r.id = a.reason_id
        WHERE a.profile_id = OLD.profile_id AND a.id <> OLD.id
          AND a.status IN ('approved', 'processed') AND NOT COALESCE(a.is_half_day, false)
          AND (v_timesheet.week_ending - (7 - GREATEST(1, LEAST(7, v_entry.day_of_week))))
            BETWEEN a.date AND COALESCE(a.end_date, a.date)
          AND lower(trim(r.name)) <> 'training'
          AND NOT (lower(trim(r.name)) = 'annual leave' AND COALESCE(a.allow_timesheet_work_on_leave, false))
      ) THEN
        RAISE EXCEPTION 'Another leave booking affects this timesheet entry. No changes were made; review the timesheet before deleting.'
          USING ERRCODE = '40001';
      END IF;
      v_expected := COALESCE(v_snapshot.original_entry, '{}'::jsonb) || v_snapshot.applied_entry;
      IF v_snapshot.applied_entry ->> 'did_not_work' = 'true'
         AND v_snapshot.applied_entry ? 'time_started' THEN
        -- The database's full-day coercion clears plant fields even though the
        -- older application snapshot payload did not list those fields.
        v_expected := v_expected || '{"operator_travel_hours":null,"operator_yard_hours":null,
          "operator_working_hours":null,"machine_travel_hours":null,"machine_start_time":null,
          "machine_finish_time":null,"machine_working_hours":null,"machine_standing_hours":null,
          "machine_operator_hours":null,"maintenance_breakdown_hours":null}'::jsonb;
      END IF;
      v_expected_jobs := CASE WHEN v_snapshot.applied_entry ? 'job_number' THEN '{}'::text[]
        ELSE v_snapshot.original_job_numbers END;
      -- Snapshots predate subsistence. Never erase a later entered payment/work edit.
      IF NOT (to_jsonb(v_entry) @> v_expected) OR v_jobs IS DISTINCT FROM v_expected_jobs
         OR COALESCE(v_entry.subsistence_payment_required, false) THEN
        RAISE EXCEPTION 'Timesheet entries have changed since this leave was applied. No changes were made; review the timesheet before deleting.'
          USING ERRCODE = '40001';
      END IF;
      IF NOT v_snapshot.had_entry THEN
        -- No original row exists: only delete an otherwise empty auto-created row.
        IF v_entry.time_started IS NOT NULL OR v_entry.time_finished IS NOT NULL
           OR COALESCE(v_entry.working_in_yard, false) OR COALESCE(v_entry.night_shift, false)
           OR COALESCE(v_entry.bank_holiday, false)
           OR v_entry.operator_travel_hours IS NOT NULL OR v_entry.operator_yard_hours IS NOT NULL
           OR v_entry.operator_working_hours IS NOT NULL OR v_entry.machine_travel_hours IS NOT NULL
           OR v_entry.machine_start_time IS NOT NULL OR v_entry.machine_finish_time IS NOT NULL
           OR v_entry.machine_working_hours IS NOT NULL OR v_entry.machine_standing_hours IS NOT NULL
           OR v_entry.machine_operator_hours IS NOT NULL OR v_entry.maintenance_breakdown_hours IS NOT NULL THEN
          RAISE EXCEPTION 'Timesheet entries have changed since this leave was applied. No changes were made.' USING ERRCODE = '40001';
        END IF;
        DELETE FROM public.timesheet_entries WHERE id = v_entry.id;
      ELSE
        SELECT * INTO v_original FROM jsonb_populate_record(v_entry, v_snapshot.original_entry);
        UPDATE public.timesheet_entries SET
          time_started = v_original.time_started, time_finished = v_original.time_finished,
          job_number = v_original.job_number, working_in_yard = v_original.working_in_yard,
          did_not_work = v_original.did_not_work, daily_total = v_original.daily_total,
          remarks = v_original.remarks, night_shift = v_original.night_shift, bank_holiday = v_original.bank_holiday,
          operator_travel_hours = v_original.operator_travel_hours, operator_yard_hours = v_original.operator_yard_hours,
          operator_working_hours = v_original.operator_working_hours, machine_travel_hours = v_original.machine_travel_hours,
          machine_start_time = v_original.machine_start_time, machine_finish_time = v_original.machine_finish_time,
          machine_working_hours = v_original.machine_working_hours, machine_standing_hours = v_original.machine_standing_hours,
          machine_operator_hours = v_original.machine_operator_hours, maintenance_breakdown_hours = v_original.maintenance_breakdown_hours
        WHERE id = v_entry.id RETURNING * INTO v_original;
        IF NOT (to_jsonb(v_original) @> v_snapshot.original_entry) THEN
          RAISE EXCEPTION 'Timesheet restoration was changed by another guard. No changes were made.' USING ERRCODE = '40001';
        END IF;
        DELETE FROM public.timesheet_entry_job_codes WHERE timesheet_entry_id = v_entry.id;
        INSERT INTO public.timesheet_entry_job_codes (timesheet_entry_id, job_number, display_order)
        SELECT v_entry.id, job, ordinality - 1
        FROM unnest(v_snapshot.original_job_numbers) WITH ORDINALITY AS jobs(job, ordinality);
      END IF;
      DELETE FROM public.timesheet_entry_leave_snapshots WHERE id = v_snapshot.id;
    ELSIF v_active AND lower(trim(v_reason)) <> 'training'
      AND NOT (lower(trim(v_reason)) = 'annual leave' AND COALESCE(OLD.allow_timesheet_work_on_leave, false))
      AND v_entry.remarks = v_remark THEN
      -- Older guardrail-created full-day rows have no snapshot. Only clear the
      -- exact empty leave shape; never infer original hours or half-day totals.
      IF EXISTS (SELECT 1 FROM public.timesheet_entry_leave_snapshots WHERE timesheet_entry_id = v_entry.id)
         OR OLD.is_half_day OR OLD.half_day_session IS NOT NULL
         OR NOT COALESCE(v_entry.did_not_work, false)
         OR v_entry.time_started IS NOT NULL OR v_entry.time_finished IS NOT NULL
         OR cardinality(v_jobs) <> 0 OR COALESCE(v_entry.working_in_yard, false)
         OR COALESCE(v_entry.night_shift, false) OR COALESCE(v_entry.bank_holiday, false)
         OR COALESCE(v_entry.subsistence_payment_required, false)
         OR v_entry.daily_total IS DISTINCT FROM (CASE WHEN v_paid THEN 9 ELSE 0 END)::numeric
         OR v_entry.operator_travel_hours IS NOT NULL OR v_entry.operator_yard_hours IS NOT NULL
         OR v_entry.operator_working_hours IS NOT NULL OR v_entry.machine_travel_hours IS NOT NULL
         OR v_entry.machine_start_time IS NOT NULL OR v_entry.machine_finish_time IS NOT NULL
         OR v_entry.machine_working_hours IS NOT NULL OR v_entry.machine_standing_hours IS NOT NULL
         OR v_entry.machine_operator_hours IS NOT NULL OR v_entry.maintenance_breakdown_hours IS NOT NULL THEN
        RAISE EXCEPTION 'Leave restoration evidence is incomplete or the timesheet has changed; no changes were made'
          USING ERRCODE = '40001';
      END IF;
      UPDATE public.timesheet_entries SET did_not_work = false, daily_total = NULL, remarks = NULL WHERE id = v_entry.id;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.timesheet_entry_leave_snapshots WHERE absence_id = OLD.id) THEN
    RAISE EXCEPTION 'Leave restoration evidence is incomplete; no changes were made' USING ERRCODE = '40001';
  END IF;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_deleted_absence_timesheets() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_reconcile_deleted_absence_timesheets
  AFTER DELETE ON public.absences
  FOR EACH ROW EXECUTE FUNCTION public.reconcile_deleted_absence_timesheets();

CREATE OR REPLACE FUNCTION public.delete_absence_with_timesheet_effects(
  p_absence_id uuid,
  p_expected_updated_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_absence public.absences%ROWTYPE;
  v_deleted_id uuid;
  v_previous_setting text := current_setting('app.absence_delete_timesheet_effects', true);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_absence_id IS NULL THEN
    RAISE EXCEPTION 'Absence id is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_absence FROM public.absences WHERE id = p_absence_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Absence record not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_absence.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'This absence has changed. Refresh and try again.' USING ERRCODE = '40001';
  END IF;
  PERFORM set_config('app.absence_delete_timesheet_effects', p_absence_id::text, true);
  -- RLS and the existing historic/closed-year/carryover triggers remain authoritative.
  DELETE FROM public.absences WHERE id = p_absence_id RETURNING id INTO v_deleted_id;
  IF v_deleted_id IS NULL THEN
    RAISE EXCEPTION 'You do not have permission to delete this absence' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.absence_delete_timesheet_effects', COALESCE(v_previous_setting, ''), true);
  RETURN v_deleted_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_absence_with_timesheet_effects(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_absence_with_timesheet_effects(uuid, timestamptz) TO authenticated;

COMMIT;
