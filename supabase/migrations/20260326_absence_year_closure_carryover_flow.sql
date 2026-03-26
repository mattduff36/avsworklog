BEGIN;

CREATE TABLE IF NOT EXISTS absence_financial_year_closures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  financial_year_start_year INTEGER NOT NULL UNIQUE,
  closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_by UUID NULL REFERENCES profiles(id) ON DELETE SET NULL,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_absence_financial_year_closures_year
  ON absence_financial_year_closures (financial_year_start_year DESC);

ALTER TABLE absence_financial_year_closures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can view absence closure state" ON absence_financial_year_closures;
CREATE POLICY "Authenticated can view absence closure state" ON absence_financial_year_closures
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Managers can create absence closure state" ON absence_financial_year_closures;
CREATE POLICY "Managers can create absence closure state" ON absence_financial_year_closures
FOR INSERT TO authenticated
WITH CHECK (effective_is_manager_admin());

DROP POLICY IF EXISTS "Managers can update absence closure state" ON absence_financial_year_closures;
CREATE POLICY "Managers can update absence closure state" ON absence_financial_year_closures
FOR UPDATE TO authenticated
USING (effective_is_manager_admin())
WITH CHECK (effective_is_manager_admin());

DROP POLICY IF EXISTS "Managers can delete absence closure state" ON absence_financial_year_closures;
CREATE POLICY "Managers can delete absence closure state" ON absence_financial_year_closures
FOR DELETE TO authenticated
USING (effective_is_manager_admin());

DROP TRIGGER IF EXISTS set_updated_at_absence_financial_year_closures ON absence_financial_year_closures;
CREATE TRIGGER set_updated_at_absence_financial_year_closures
  BEFORE UPDATE ON absence_financial_year_closures
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

GRANT ALL ON absence_financial_year_closures TO authenticated;

ALTER TABLE absence_allowance_carryovers
  DROP CONSTRAINT IF EXISTS absence_allowance_carryovers_non_negative;

CREATE OR REPLACE FUNCTION is_absence_financial_year_closed(
  p_financial_year_start_year INTEGER
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM absence_financial_year_closures
    WHERE financial_year_start_year = p_financial_year_start_year
  );
$$;

CREATE OR REPLACE FUNCTION recalculate_financial_year_carryover_for_profile(
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
    AND a.status = 'approved'
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

CREATE OR REPLACE FUNCTION close_absence_financial_year_bookings(
  p_financial_year_start_year INTEGER,
  p_actor_profile_id UUID DEFAULT auth.uid(),
  p_notes TEXT DEFAULT NULL
)
RETURNS TABLE (
  financial_year_start_year INTEGER,
  pending_count INTEGER,
  carryovers_written INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_authenticated_profile_id UUID;
  v_start_date DATE;
  v_end_date DATE;
  v_pending_count INTEGER;
  v_carryovers_written INTEGER := 0;
  v_profile_id UUID;
  v_carryover_days NUMERIC;
BEGIN
  v_authenticated_profile_id := auth.uid();
  IF v_authenticated_profile_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  IF NOT effective_is_manager_admin() THEN
    RAISE EXCEPTION 'Only managers or admins can close a financial year.';
  END IF;

  IF p_actor_profile_id IS DISTINCT FROM v_authenticated_profile_id THEN
    RAISE EXCEPTION 'Actor profile mismatch for close-year operation.';
  END IF;

  v_start_date := make_date(p_financial_year_start_year, 4, 1);
  v_end_date := make_date(p_financial_year_start_year + 1, 3, 31);

  SELECT COUNT(*)::INTEGER
  INTO v_pending_count
  FROM absences a
  WHERE a.status = 'pending'
    AND a.date <= v_end_date
    AND COALESCE(a.end_date, a.date) >= v_start_date;

  IF v_pending_count > 0 THEN
    RAISE EXCEPTION 'Current year still has pending bookings. Accept or decline these first.';
  END IF;

  INSERT INTO absence_financial_year_closures (
    financial_year_start_year,
    closed_at,
    closed_by,
    notes
  )
  VALUES (
    p_financial_year_start_year,
    NOW(),
    p_actor_profile_id,
    p_notes
  )
  ON CONFLICT (financial_year_start_year)
  DO UPDATE SET
    closed_at = EXCLUDED.closed_at,
    closed_by = EXCLUDED.closed_by,
    notes = EXCLUDED.notes,
    updated_at = NOW();

  FOR v_profile_id IN
    SELECT p.id
    FROM profiles p
    WHERE COALESCE(p.full_name, '') NOT ILIKE '%(Deleted User)%'
    ORDER BY p.id
  LOOP
    v_carryover_days := recalculate_financial_year_carryover_for_profile(
      p_financial_year_start_year,
      v_profile_id,
      p_actor_profile_id
    );
    IF v_carryover_days <> 0 THEN
      v_carryovers_written := v_carryovers_written + 1;
    END IF;
  END LOOP;

  RETURN QUERY
  SELECT
    p_financial_year_start_year,
    v_pending_count,
    v_carryovers_written;
END;
$$;

CREATE OR REPLACE FUNCTION recalculate_closed_year_carryover_after_absence_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_source_year INTEGER;
  v_new_source_year INTEGER;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old_source_year := absence_financial_year_start_year(OLD.date);
    IF is_absence_financial_year_closed(v_old_source_year) THEN
      PERFORM recalculate_financial_year_carryover_for_profile(
        v_old_source_year,
        OLD.profile_id,
        auth.uid()
      );
    END IF;
  END IF;

  IF TG_OP <> 'DELETE' THEN
    v_new_source_year := absence_financial_year_start_year(NEW.date);
    IF is_absence_financial_year_closed(v_new_source_year) THEN
      PERFORM recalculate_financial_year_carryover_for_profile(
        v_new_source_year,
        NEW.profile_id,
        auth.uid()
      );
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_recalculate_closed_year_carryover ON absences;
CREATE TRIGGER trg_recalculate_closed_year_carryover
  AFTER INSERT OR UPDATE OR DELETE ON absences
  FOR EACH ROW
  EXECUTE FUNCTION recalculate_closed_year_carryover_after_absence_change();

DROP POLICY IF EXISTS "Users can create own absences" ON absences;
CREATE POLICY "Users can create own absences" ON absences
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = profile_id
  AND auth.uid() = created_by
  AND NOT is_absence_financial_year_closed(absence_financial_year_start_year(date))
  AND EXISTS (
    SELECT 1
    FROM absence_reasons ar
    WHERE ar.id = reason_id
      AND ar.is_active = true
      AND lower(ar.name) IN ('annual leave', 'unpaid leave')
  )
);

REVOKE ALL ON FUNCTION is_absence_financial_year_closed(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_absence_financial_year_closed(INTEGER) TO authenticated;

REVOKE ALL ON FUNCTION recalculate_financial_year_carryover_for_profile(INTEGER, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION recalculate_financial_year_carryover_for_profile(INTEGER, UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION close_absence_financial_year_bookings(INTEGER, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION close_absence_financial_year_bookings(INTEGER, UUID, TEXT) TO authenticated;

COMMIT;
