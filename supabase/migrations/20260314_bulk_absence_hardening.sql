-- Bulk absence batch tracking for deterministic undo operations
CREATE TABLE IF NOT EXISTS absence_bulk_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID NULL REFERENCES profiles(id) ON DELETE SET NULL,
  reason_id UUID NOT NULL REFERENCES absence_reasons(id) ON DELETE RESTRICT,
  reason_name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  notes TEXT NULL,
  apply_to_all BOOLEAN NOT NULL DEFAULT TRUE,
  role_names TEXT[] NOT NULL DEFAULT '{}',
  explicit_profile_ids UUID[] NOT NULL DEFAULT '{}',
  targeted_count INTEGER NOT NULL DEFAULT 0,
  created_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_absence_bulk_batches_created_at
ON absence_bulk_batches (created_at DESC);

ALTER TABLE absence_bulk_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Managers can view bulk absence batches" ON absence_bulk_batches;
CREATE POLICY "Managers can view bulk absence batches" ON absence_bulk_batches
FOR SELECT TO authenticated
USING (effective_is_manager_admin());

DROP POLICY IF EXISTS "Managers can create bulk absence batches" ON absence_bulk_batches;
CREATE POLICY "Managers can create bulk absence batches" ON absence_bulk_batches
FOR INSERT TO authenticated
WITH CHECK (effective_is_manager_admin());

DROP POLICY IF EXISTS "Managers can update bulk absence batches" ON absence_bulk_batches;
CREATE POLICY "Managers can update bulk absence batches" ON absence_bulk_batches
FOR UPDATE TO authenticated
USING (effective_is_manager_admin())
WITH CHECK (effective_is_manager_admin());

DROP POLICY IF EXISTS "Managers can delete bulk absence batches" ON absence_bulk_batches;
CREATE POLICY "Managers can delete bulk absence batches" ON absence_bulk_batches
FOR DELETE TO authenticated
USING (effective_is_manager_admin());

ALTER TABLE absences
ADD COLUMN IF NOT EXISTS bulk_batch_id UUID NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'absences_bulk_batch_id_fkey'
  ) THEN
    ALTER TABLE absences
      ADD CONSTRAINT absences_bulk_batch_id_fkey
      FOREIGN KEY (bulk_batch_id)
      REFERENCES absence_bulk_batches(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_absences_bulk_batch_id
ON absences (bulk_batch_id);

CREATE OR REPLACE FUNCTION validate_absence_conflict()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  new_start DATE;
  new_end DATE;
  existing_row RECORD;
  existing_start DATE;
  existing_end DATE;
BEGIN
  IF NEW.status NOT IN ('approved', 'pending') THEN
    RETURN NEW;
  END IF;

  new_start := NEW.date;
  new_end := COALESCE(NEW.end_date, NEW.date);

  IF NEW.is_half_day = TRUE AND NEW.half_day_session IS NULL THEN
    RAISE EXCEPTION 'Half-day absences require a half-day session (AM/PM)';
  END IF;

  IF NEW.is_half_day = TRUE AND new_end <> new_start THEN
    RAISE EXCEPTION 'Half-day absences must be single-day entries';
  END IF;

  FOR existing_row IN
    SELECT
      id,
      date,
      end_date,
      is_half_day,
      half_day_session
    FROM absences
    WHERE profile_id = NEW.profile_id
      AND status IN ('approved', 'pending')
      AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND daterange(date, COALESCE(end_date, date), '[]')
        && daterange(new_start, new_end, '[]')
  LOOP
    existing_start := existing_row.date;
    existing_end := COALESCE(existing_row.end_date, existing_row.date);

    IF NEW.is_half_day = FALSE THEN
      RAISE EXCEPTION 'Absence conflict for profile % on % to %', NEW.profile_id, new_start, new_end;
    END IF;

    IF existing_start <> new_start OR existing_end <> new_start THEN
      RAISE EXCEPTION 'Half-day absence conflicts with existing multi-day or different-day absence';
    END IF;

    IF existing_row.is_half_day = FALSE THEN
      RAISE EXCEPTION 'Half-day absence conflicts with existing full-day absence';
    END IF;

    IF existing_row.half_day_session = NEW.half_day_session THEN
      RAISE EXCEPTION 'Half-day absence conflicts with existing % booking on %', NEW.half_day_session, new_start;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_absence_conflict ON absences;

CREATE TRIGGER trg_validate_absence_conflict
BEFORE INSERT OR UPDATE OF profile_id, date, end_date, status, is_half_day, half_day_session
ON absences
FOR EACH ROW
EXECUTE FUNCTION validate_absence_conflict();
