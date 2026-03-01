-- Fix stale references left by the vehicle_id → van_id / vehicle_categories → van_categories renames
-- Discovered by post-migration proactive audit.
--
-- Issues fixed:
--   1. sync_vehicle_type_from_category() — queried FROM vehicle_categories (now van_categories)
--      Effect: every vans INSERT/UPDATE with a category_id silently failed.
--   2. van_archive.vehicle_id — app code inserts van_id but column was still vehicle_id.
--      Effect: archiving/retiring a van raised a PostgREST column-not-found error.
--   3. get_latest_mot_test() and get_latest_passed_mot() — queried WHERE vehicle_id in
--      mot_test_history (column is now van_id).

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Fix sync_vehicle_type_from_category trigger function
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION sync_vehicle_type_from_category()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.category_id IS NOT NULL THEN
    NEW.vehicle_type := (
      SELECT name
      FROM van_categories
      WHERE id = NEW.category_id
    );
  ELSE
    NEW.vehicle_type := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Rename van_archive.vehicle_id → van_id
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'van_archive' AND column_name = 'vehicle_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'van_archive' AND column_name = 'van_id'
  ) THEN
    ALTER TABLE public.van_archive RENAME COLUMN vehicle_id TO van_id;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Fix get_latest_mot_test() — vehicle_id → van_id in mot_test_history
--    Must DROP first because parameter name change triggers return-type check.
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS get_latest_mot_test(UUID);

CREATE OR REPLACE FUNCTION get_latest_mot_test(p_van_id UUID)
RETURNS SETOF mot_test_history AS $$
  SELECT *
  FROM mot_test_history
  WHERE van_id = p_van_id
  ORDER BY completed_date DESC
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Fix get_latest_passed_mot() — vehicle_id → van_id in mot_test_history
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS get_latest_passed_mot(UUID);

CREATE OR REPLACE FUNCTION get_latest_passed_mot(p_van_id UUID)
RETURNS SETOF mot_test_history AS $$
  SELECT *
  FROM mot_test_history
  WHERE van_id = p_van_id
    AND test_result = 'PASSED'
    AND expiry_date IS NOT NULL
  ORDER BY completed_date DESC
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

COMMIT;
