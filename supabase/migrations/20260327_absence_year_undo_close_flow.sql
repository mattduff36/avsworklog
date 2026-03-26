BEGIN;

CREATE TABLE IF NOT EXISTS absence_financial_year_close_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  financial_year_start_year INTEGER NOT NULL UNIQUE,
  target_financial_year_start_year INTEGER NOT NULL,
  snapshot_taken_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  snapshot_taken_by UUID NULL REFERENCES profiles(id) ON DELETE SET NULL,
  restored_at TIMESTAMPTZ NULL,
  restored_by UUID NULL REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_absence_financial_year_close_snapshots_year
  ON absence_financial_year_close_snapshots (financial_year_start_year DESC);

CREATE TABLE IF NOT EXISTS absence_financial_year_close_snapshot_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES absence_financial_year_close_snapshots(id) ON DELETE CASCADE,
  carryover_id UUID NOT NULL,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  financial_year_start_year INTEGER NOT NULL,
  source_financial_year_start_year INTEGER NOT NULL,
  carried_days NUMERIC(6,2) NOT NULL,
  auto_generated BOOLEAN NOT NULL,
  generation_source TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,
  generated_by UUID NULL REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT absence_financial_year_close_snapshot_rows_key UNIQUE (snapshot_id, carryover_id)
);

CREATE INDEX IF NOT EXISTS idx_absence_financial_year_close_snapshot_rows_snapshot
  ON absence_financial_year_close_snapshot_rows (snapshot_id);

ALTER TABLE absence_financial_year_close_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE absence_financial_year_close_snapshot_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Managers can view absence close snapshots" ON absence_financial_year_close_snapshots;
CREATE POLICY "Managers can view absence close snapshots" ON absence_financial_year_close_snapshots
FOR SELECT TO authenticated
USING (effective_is_manager_admin());

DROP POLICY IF EXISTS "Admins can manage absence close snapshots" ON absence_financial_year_close_snapshots;
CREATE POLICY "Admins can manage absence close snapshots" ON absence_financial_year_close_snapshots
FOR ALL TO authenticated
USING (effective_is_admin())
WITH CHECK (effective_is_admin());

DROP POLICY IF EXISTS "Managers can view absence close snapshot rows" ON absence_financial_year_close_snapshot_rows;
CREATE POLICY "Managers can view absence close snapshot rows" ON absence_financial_year_close_snapshot_rows
FOR SELECT TO authenticated
USING (effective_is_manager_admin());

DROP POLICY IF EXISTS "Admins can manage absence close snapshot rows" ON absence_financial_year_close_snapshot_rows;
CREATE POLICY "Admins can manage absence close snapshot rows" ON absence_financial_year_close_snapshot_rows
FOR ALL TO authenticated
USING (effective_is_admin())
WITH CHECK (effective_is_admin());

DROP TRIGGER IF EXISTS set_updated_at_absence_financial_year_close_snapshots ON absence_financial_year_close_snapshots;
CREATE TRIGGER set_updated_at_absence_financial_year_close_snapshots
  BEFORE UPDATE ON absence_financial_year_close_snapshots
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_absence_financial_year_close_snapshot_rows ON absence_financial_year_close_snapshot_rows;
CREATE TRIGGER set_updated_at_absence_financial_year_close_snapshot_rows
  BEFORE UPDATE ON absence_financial_year_close_snapshot_rows
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

GRANT ALL ON absence_financial_year_close_snapshots TO authenticated;
GRANT ALL ON absence_financial_year_close_snapshot_rows TO authenticated;

CREATE OR REPLACE FUNCTION snapshot_financial_year_carryovers_before_close(
  p_source_financial_year_start_year INTEGER,
  p_actor_profile_id UUID DEFAULT auth.uid()
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_target_financial_year_start_year INTEGER;
  v_snapshot_id UUID;
BEGIN
  v_target_financial_year_start_year := p_source_financial_year_start_year + 1;

  INSERT INTO absence_financial_year_close_snapshots (
    financial_year_start_year,
    target_financial_year_start_year,
    snapshot_taken_at,
    snapshot_taken_by,
    restored_at,
    restored_by
  )
  VALUES (
    p_source_financial_year_start_year,
    v_target_financial_year_start_year,
    NOW(),
    p_actor_profile_id,
    NULL,
    NULL
  )
  ON CONFLICT ON CONSTRAINT absence_financial_year_close_snap_financial_year_start_year_key
  DO UPDATE SET
    target_financial_year_start_year = EXCLUDED.target_financial_year_start_year,
    snapshot_taken_at = EXCLUDED.snapshot_taken_at,
    snapshot_taken_by = EXCLUDED.snapshot_taken_by,
    restored_at = NULL,
    restored_by = NULL,
    updated_at = NOW()
  RETURNING id INTO v_snapshot_id;

  DELETE FROM absence_financial_year_close_snapshot_rows
  WHERE snapshot_id = v_snapshot_id;

  INSERT INTO absence_financial_year_close_snapshot_rows (
    snapshot_id,
    carryover_id,
    profile_id,
    financial_year_start_year,
    source_financial_year_start_year,
    carried_days,
    auto_generated,
    generation_source,
    generated_at,
    generated_by,
    created_at,
    updated_at
  )
  SELECT
    v_snapshot_id,
    c.id,
    c.profile_id,
    c.financial_year_start_year,
    c.source_financial_year_start_year,
    c.carried_days,
    c.auto_generated,
    c.generation_source,
    c.generated_at,
    c.generated_by,
    c.created_at,
    c.updated_at
  FROM absence_allowance_carryovers c
  WHERE c.financial_year_start_year = v_target_financial_year_start_year
  ORDER BY c.profile_id;

  RETURN v_snapshot_id;
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

  PERFORM snapshot_financial_year_carryovers_before_close(
    p_financial_year_start_year,
    p_actor_profile_id
  );

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
  ON CONFLICT ON CONSTRAINT absence_financial_year_closures_financial_year_start_year_key
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

CREATE OR REPLACE FUNCTION get_latest_absence_close_undo_status()
RETURNS TABLE (
  latest_closed_financial_year_start_year INTEGER,
  latest_closed_financial_year_label TEXT,
  can_undo BOOLEAN,
  blocked_reason TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_latest_closed_financial_year_start_year INTEGER;
  v_target_financial_year_start_year INTEGER;
  v_financial_year_end_date DATE;
  v_has_archive_data BOOLEAN;
  v_has_snapshot BOOLEAN;
BEGIN
  SELECT c.financial_year_start_year
  INTO v_latest_closed_financial_year_start_year
  FROM absence_financial_year_closures c
  ORDER BY c.financial_year_start_year DESC
  LIMIT 1;

  IF v_latest_closed_financial_year_start_year IS NULL THEN
    RETURN QUERY
    SELECT
      NULL::INTEGER,
      NULL::TEXT,
      FALSE,
      'No closed financial year found to undo.'::TEXT;
    RETURN;
  END IF;

  v_target_financial_year_start_year := v_latest_closed_financial_year_start_year + 1;
  v_financial_year_end_date := make_date(v_latest_closed_financial_year_start_year + 1, 3, 31);

  IF CURRENT_DATE > v_financial_year_end_date THEN
    RETURN QUERY
    SELECT
      v_latest_closed_financial_year_start_year,
      format('%s/%s', v_latest_closed_financial_year_start_year, right((v_latest_closed_financial_year_start_year + 1)::TEXT, 2)),
      FALSE,
      'Cannot undo close because this financial year has already ended.'::TEXT;
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM absence_financial_year_archives a
    WHERE a.financial_year_start_year IN (
      v_latest_closed_financial_year_start_year,
      v_target_financial_year_start_year
    )
  )
  INTO v_has_archive_data;

  IF v_has_archive_data THEN
    RETURN QUERY
    SELECT
      v_latest_closed_financial_year_start_year,
      format('%s/%s', v_latest_closed_financial_year_start_year, right((v_latest_closed_financial_year_start_year + 1)::TEXT, 2)),
      FALSE,
      'Cannot undo close because archive data already exists for this year.'::TEXT;
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM absence_financial_year_close_snapshots s
    WHERE s.financial_year_start_year = v_latest_closed_financial_year_start_year
  )
  INTO v_has_snapshot;

  IF NOT v_has_snapshot THEN
    RETURN QUERY
    SELECT
      v_latest_closed_financial_year_start_year,
      format('%s/%s', v_latest_closed_financial_year_start_year, right((v_latest_closed_financial_year_start_year + 1)::TEXT, 2)),
      FALSE,
      'Cannot undo close because no pre-close snapshot exists for this year.'::TEXT;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    v_latest_closed_financial_year_start_year,
    format('%s/%s', v_latest_closed_financial_year_start_year, right((v_latest_closed_financial_year_start_year + 1)::TEXT, 2)),
    TRUE,
    NULL::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION undo_close_absence_financial_year_bookings(
  p_actor_profile_id UUID DEFAULT auth.uid()
)
RETURNS TABLE (
  financial_year_start_year INTEGER,
  restored_carryovers INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_authenticated_profile_id UUID;
  v_latest_closed_financial_year_start_year INTEGER;
  v_target_financial_year_start_year INTEGER;
  v_can_undo BOOLEAN;
  v_blocked_reason TEXT;
  v_snapshot_id UUID;
  v_restored_carryovers INTEGER := 0;
BEGIN
  v_authenticated_profile_id := auth.uid();
  IF v_authenticated_profile_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  IF NOT effective_is_admin() THEN
    RAISE EXCEPTION 'Only admins can undo a closed financial year.';
  END IF;

  IF p_actor_profile_id IS DISTINCT FROM v_authenticated_profile_id THEN
    RAISE EXCEPTION 'Actor profile mismatch for undo-close operation.';
  END IF;

  SELECT
    s.latest_closed_financial_year_start_year,
    s.can_undo,
    s.blocked_reason
  INTO
    v_latest_closed_financial_year_start_year,
    v_can_undo,
    v_blocked_reason
  FROM get_latest_absence_close_undo_status() s;

  IF v_latest_closed_financial_year_start_year IS NULL THEN
    RAISE EXCEPTION 'No closed financial year found to undo.';
  END IF;

  IF NOT COALESCE(v_can_undo, FALSE) THEN
    RAISE EXCEPTION '%', COALESCE(v_blocked_reason, 'Cannot undo close for this financial year.');
  END IF;

  PERFORM 1
  FROM absence_financial_year_closures c
  WHERE c.financial_year_start_year = v_latest_closed_financial_year_start_year
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No closed financial year found to undo.';
  END IF;

  SELECT
    s.id,
    s.target_financial_year_start_year
  INTO
    v_snapshot_id,
    v_target_financial_year_start_year
  FROM absence_financial_year_close_snapshots s
  WHERE s.financial_year_start_year = v_latest_closed_financial_year_start_year
  FOR UPDATE;

  IF v_snapshot_id IS NULL THEN
    RAISE EXCEPTION 'Cannot undo close because no pre-close snapshot exists for this year.';
  END IF;

  DELETE FROM absence_allowance_carryovers c
  WHERE c.financial_year_start_year = v_target_financial_year_start_year;

  INSERT INTO absence_allowance_carryovers (
    id,
    profile_id,
    financial_year_start_year,
    source_financial_year_start_year,
    carried_days,
    auto_generated,
    generation_source,
    generated_at,
    generated_by,
    created_at,
    updated_at
  )
  SELECT
    r.carryover_id,
    r.profile_id,
    r.financial_year_start_year,
    r.source_financial_year_start_year,
    r.carried_days,
    r.auto_generated,
    r.generation_source,
    r.generated_at,
    r.generated_by,
    r.created_at,
    r.updated_at
  FROM absence_financial_year_close_snapshot_rows r
  WHERE r.snapshot_id = v_snapshot_id
  ORDER BY r.profile_id;

  GET DIAGNOSTICS v_restored_carryovers = ROW_COUNT;

  UPDATE absence_financial_year_close_snapshots
  SET
    restored_at = NOW(),
    restored_by = p_actor_profile_id,
    updated_at = NOW()
  WHERE id = v_snapshot_id;

  DELETE FROM absence_financial_year_closures c
  WHERE c.financial_year_start_year = v_latest_closed_financial_year_start_year;

  RETURN QUERY
  SELECT
    v_latest_closed_financial_year_start_year,
    v_restored_carryovers;
END;
$$;

REVOKE ALL ON FUNCTION snapshot_financial_year_carryovers_before_close(INTEGER, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION snapshot_financial_year_carryovers_before_close(INTEGER, UUID) TO authenticated;

REVOKE ALL ON FUNCTION get_latest_absence_close_undo_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_latest_absence_close_undo_status() TO authenticated;

REVOKE ALL ON FUNCTION undo_close_absence_financial_year_bookings(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION undo_close_absence_financial_year_bookings(UUID) TO authenticated;

COMMIT;
