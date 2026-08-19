BEGIN;

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
  v_is_system_account BOOLEAN := FALSE;
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

  SELECT
    CASE
      WHEN COALESCE(is_system_account, FALSE) THEN COALESCE(annual_holiday_allowance_days, 0)
      ELSE COALESCE(annual_holiday_allowance_days, 28)
    END,
    COALESCE(is_system_account, FALSE)
  INTO v_base_allowance, v_is_system_account
  FROM profiles
  WHERE id = p_profile_id;

  IF v_is_system_account THEN
    DELETE FROM absence_allowance_carryovers
    WHERE profile_id = p_profile_id
      AND financial_year_start_year = v_target_financial_year_start_year;
    RETURN 0;
  END IF;

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

COMMIT;
