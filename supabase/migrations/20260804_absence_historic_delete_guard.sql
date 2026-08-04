-- Guard historic / taken absence deletes for non-admin actors.
-- Full-access admins (effective_is_admin) may still delete past/approved/processed rows.
-- Archive move bypass preserved via app.absence_archive_move.
-- Privileged year-setup / bulk undo use SECURITY DEFINER RPCs with overview-all or admin checks
-- plus app.absence_historic_delete_bypass (no blanket auto_generated trigger exemption).

CREATE OR REPLACE FUNCTION public.guard_absence_historic_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(current_setting('app.absence_archive_move', true), '') = 'on' THEN
    RETURN OLD;
  END IF;

  IF COALESCE(current_setting('app.absence_historic_delete_bypass', true), '') = 'on' THEN
    RETURN OLD;
  END IF;

  IF public.effective_is_admin() THEN
    RETURN OLD;
  END IF;

  IF OLD.date < CURRENT_DATE THEN
    RAISE EXCEPTION 'Cannot delete past absences without admin access';
  END IF;

  IF OLD.status IN ('approved', 'processed') THEN
    RAISE EXCEPTION 'Cannot delete approved or processed absences without admin access';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_absence_historic_delete ON public.absences;
CREATE TRIGGER trg_guard_absence_historic_delete
  BEFORE DELETE ON public.absences
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_absence_historic_delete();

CREATE OR REPLACE FUNCTION public.can_actor_run_absence_global_delete()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN FALSE;
  END IF;

  -- View-as aware admin check.
  IF public.effective_is_admin() THEN
    RETURN TRUE;
  END IF;

  -- While viewing as another role, do not use the actor's actual secondary matrix.
  IF public.view_as_role_id() IS NOT NULL THEN
    RETURN FALSE;
  END IF;

  RETURN COALESCE(
    public.absence_secondary_effective_cell(auth.uid(), 'see_manage_overview_all'),
    FALSE
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_absences_for_bulk_batch(p_batch_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  removed_count integer := 0;
BEGIN
  IF p_batch_id IS NULL THEN
    RAISE EXCEPTION 'Bulk batch id is required';
  END IF;

  IF NOT public.can_actor_run_absence_global_delete() THEN
    RAISE EXCEPTION 'Forbidden: admin or Records & Admin ALL scope required';
  END IF;

  PERFORM set_config('app.absence_historic_delete_bypass', 'on', true);

  DELETE FROM public.absences
  WHERE bulk_batch_id = p_batch_id;

  GET DIAGNOSTICS removed_count = ROW_COUNT;
  RETURN removed_count;
END;
$$;

-- Privileged year-setup undo: locks latest generation row, deletes absences + marker atomically.
CREATE OR REPLACE FUNCTION public.delete_latest_generated_financial_year_absences(
  p_delete_user_entered boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  latest_generation_id uuid;
  latest_start_year integer;
  fy_start date;
  fy_end date;
  fy_label text;
  v_generation_source text;
  existing_user_entered_count integer := 0;
  removed_generated integer := 0;
  removed_existing integer := 0;
BEGIN
  IF NOT public.can_actor_run_absence_global_delete() THEN
    RAISE EXCEPTION 'Forbidden: admin or Records & Admin ALL scope required';
  END IF;

  SELECT id, financial_year_start_year
  INTO latest_generation_id, latest_start_year
  FROM public.absence_financial_year_generations
  ORDER BY financial_year_start_year DESC
  LIMIT 1
  FOR UPDATE;

  IF latest_generation_id IS NULL OR latest_start_year IS NULL THEN
    RAISE EXCEPTION 'No generated financial year found to remove.';
  END IF;

  fy_start := make_date(latest_start_year, 4, 1);
  fy_end := make_date(latest_start_year + 1, 3, 31);
  fy_label := latest_start_year::text || '/' || right((latest_start_year + 1)::text, 2);
  v_generation_source := 'uk-bank-holiday:england-and-wales:' || fy_label;

  SELECT COUNT(*)::integer
  INTO existing_user_entered_count
  FROM public.absences
  WHERE date >= fy_start
    AND date <= fy_end
    AND COALESCE(auto_generated, FALSE) = FALSE
    AND status IS DISTINCT FROM 'cancelled';

  IF existing_user_entered_count > 0 AND NOT COALESCE(p_delete_user_entered, FALSE) THEN
    RAISE EXCEPTION
      'Cannot remove %. User-entered leave requests already exist in this financial year. Enable booking deletion to continue.',
      fy_label;
  END IF;

  PERFORM set_config('app.absence_historic_delete_bypass', 'on', true);

  IF COALESCE(p_delete_user_entered, FALSE) THEN
    DELETE FROM public.absences
    WHERE date >= fy_start
      AND date <= fy_end
      AND COALESCE(auto_generated, FALSE) = FALSE
      AND status IS DISTINCT FROM 'cancelled';
    GET DIAGNOSTICS removed_existing = ROW_COUNT;
  END IF;

  DELETE FROM public.absences
  WHERE date >= fy_start
    AND date <= fy_end
    AND COALESCE(auto_generated, FALSE) = TRUE
    AND COALESCE(is_bank_holiday, FALSE) = TRUE
    AND generation_source = v_generation_source;
  GET DIAGNOSTICS removed_generated = ROW_COUNT;

  DELETE FROM public.absence_financial_year_generations
  WHERE id = latest_generation_id;

  RETURN jsonb_build_object(
    'removedGeneratedAbsences', removed_generated,
    'removedExistingAbsences', removed_existing,
    'financialYearStartYear', latest_start_year,
    'financialYearLabel', fy_label,
    'removedGenerationId', latest_generation_id
  );
END;
$$;

-- Drop superseded over-broad signature if present from earlier iteration.
DROP FUNCTION IF EXISTS public.delete_absences_for_financial_year_undo(date, date, boolean, text);

REVOKE ALL ON FUNCTION public.can_actor_run_absence_global_delete() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_absences_for_bulk_batch(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_latest_generated_financial_year_absences(boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.can_actor_run_absence_global_delete() TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_absences_for_bulk_batch(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_latest_generated_financial_year_absences(boolean) TO authenticated;
