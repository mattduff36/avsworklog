BEGIN;

CREATE TABLE IF NOT EXISTS absences_archive (
  id UUID PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES profiles(id),
  date DATE NOT NULL,
  end_date DATE NULL,
  reason_id UUID NOT NULL REFERENCES absence_reasons(id),
  duration_days NUMERIC(4,2) NOT NULL,
  is_half_day BOOLEAN NOT NULL DEFAULT FALSE,
  half_day_session TEXT NULL CHECK (half_day_session IN ('AM', 'PM')),
  notes TEXT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  created_by UUID NULL REFERENCES profiles(id),
  approved_by UUID NULL REFERENCES profiles(id),
  approved_at TIMESTAMPTZ NULL,
  is_bank_holiday BOOLEAN NOT NULL DEFAULT FALSE,
  auto_generated BOOLEAN NOT NULL DEFAULT FALSE,
  generation_source TEXT NULL,
  holiday_key TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  financial_year_start_year INTEGER NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_by UUID NULL REFERENCES profiles(id),
  archive_run_id UUID NULL
);

CREATE INDEX IF NOT EXISTS idx_absences_archive_date ON absences_archive(date DESC);
CREATE INDEX IF NOT EXISTS idx_absences_archive_profile_id ON absences_archive(profile_id);
CREATE INDEX IF NOT EXISTS idx_absences_archive_status ON absences_archive(status);
CREATE INDEX IF NOT EXISTS idx_absences_archive_reason_id ON absences_archive(reason_id);
CREATE INDEX IF NOT EXISTS idx_absences_archive_fy_start_year ON absences_archive(financial_year_start_year DESC);

CREATE TABLE IF NOT EXISTS absence_financial_year_archives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  financial_year_start_year INTEGER NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_by UUID NULL REFERENCES profiles(id),
  row_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT NULL,
  idempotency_key TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_absence_fy_archives_idempotency_key
  ON absence_financial_year_archives(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_absence_fy_archives_fy_year
  ON absence_financial_year_archives(financial_year_start_year DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_absences_archive_run_id'
  ) THEN
    ALTER TABLE absences_archive
      ADD CONSTRAINT fk_absences_archive_run_id
      FOREIGN KEY (archive_run_id)
      REFERENCES absence_financial_year_archives(id)
      ON DELETE SET NULL;
  END IF;
END$$;

ALTER TABLE absences_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE absence_financial_year_archives ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own archived absences" ON absences_archive;
CREATE POLICY "Users can view own archived absences" ON absences_archive
FOR SELECT TO authenticated
USING (auth.uid() = profile_id);

DROP POLICY IF EXISTS "Managers can view all archived absences" ON absences_archive;
CREATE POLICY "Managers can view all archived absences" ON absences_archive
FOR SELECT TO authenticated
USING (effective_is_manager_admin());

DROP POLICY IF EXISTS "Managers can view archive runs" ON absence_financial_year_archives;
CREATE POLICY "Managers can view archive runs" ON absence_financial_year_archives
FOR SELECT TO authenticated
USING (effective_is_manager_admin());

DROP POLICY IF EXISTS "Managers can insert archive runs" ON absence_financial_year_archives;
CREATE POLICY "Managers can insert archive runs" ON absence_financial_year_archives
FOR INSERT TO authenticated
WITH CHECK (effective_is_manager_admin());

DROP POLICY IF EXISTS "Managers can update archive runs" ON absence_financial_year_archives;
CREATE POLICY "Managers can update archive runs" ON absence_financial_year_archives
FOR UPDATE TO authenticated
USING (effective_is_manager_admin())
WITH CHECK (effective_is_manager_admin());

CREATE OR REPLACE FUNCTION absence_financial_year_start_year(target_date DATE)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN EXTRACT(MONTH FROM target_date) < 4
      OR (EXTRACT(MONTH FROM target_date) = 4 AND EXTRACT(DAY FROM target_date) < 6)
    THEN EXTRACT(YEAR FROM target_date)::INTEGER - 1
    ELSE EXTRACT(YEAR FROM target_date)::INTEGER
  END;
$$;

CREATE OR REPLACE FUNCTION absence_is_closed_financial_year(target_date DATE)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT CURRENT_DATE > make_date(absence_financial_year_start_year(target_date) + 1, 4, 5);
$$;

CREATE OR REPLACE FUNCTION guard_absence_closed_financial_year_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_date DATE;
BEGIN
  IF COALESCE(current_setting('app.absence_archive_move', true), '') = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  target_date := CASE WHEN TG_OP = 'DELETE' THEN OLD.date ELSE NEW.date END;

  IF absence_is_closed_financial_year(target_date) THEN
    RAISE EXCEPTION 'Cannot modify absences from a closed financial year';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_absence_closed_fy_update ON absences;
CREATE TRIGGER trg_guard_absence_closed_fy_update
  BEFORE UPDATE ON absences
  FOR EACH ROW EXECUTE FUNCTION guard_absence_closed_financial_year_mutation();

DROP TRIGGER IF EXISTS trg_guard_absence_closed_fy_delete ON absences;
CREATE TRIGGER trg_guard_absence_closed_fy_delete
  BEFORE DELETE ON absences
  FOR EACH ROW EXECUTE FUNCTION guard_absence_closed_financial_year_mutation();

DROP TRIGGER IF EXISTS set_updated_at_absence_financial_year_archives ON absence_financial_year_archives;
CREATE TRIGGER set_updated_at_absence_financial_year_archives
  BEFORE UPDATE ON absence_financial_year_archives
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE OR REPLACE FUNCTION archive_closed_financial_year_absences(
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
AS $$
DECLARE
  v_start_date DATE;
  v_end_date DATE;
  v_existing_run RECORD;
  v_run_id UUID;
  v_row_count INTEGER;
BEGIN
  v_start_date := make_date(p_financial_year_start_year, 4, 6);
  v_end_date := make_date(p_financial_year_start_year + 1, 4, 5);

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

REVOKE ALL ON FUNCTION archive_closed_financial_year_absences(INTEGER, UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION archive_closed_financial_year_absences(INTEGER, UUID, TEXT, TEXT, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION get_archive_eligible_financial_years()
RETURNS TABLE (financial_year_start_year INTEGER)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT absence_financial_year_start_year(a.date) AS financial_year_start_year
  FROM absences a
  WHERE absence_is_closed_financial_year(a.date)
  ORDER BY financial_year_start_year ASC;
$$;

REVOKE ALL ON FUNCTION get_archive_eligible_financial_years() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_archive_eligible_financial_years() TO authenticated;

COMMIT;
