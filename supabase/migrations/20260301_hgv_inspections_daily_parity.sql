-- =============================================================================
-- HGV inspections daily parity alignment
-- =============================================================================
-- Align hgv_inspections with daily inspection behavior and extend child-table
-- RLS policies so inspection_items/photos/daily_hours can reference HGV rows.

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) Enforce daily HGV inspection semantics
-- -----------------------------------------------------------------------------

-- Backfill any legacy values before tightening constraints.
UPDATE hgv_inspections
SET status = 'submitted',
    submitted_at = COALESCE(submitted_at, NOW())
WHERE status = 'draft';

UPDATE hgv_inspections
SET inspection_end_date = inspection_date
WHERE inspection_end_date IS NULL;

-- Remove weekly-era constraints/checks.
ALTER TABLE hgv_inspections
  DROP CONSTRAINT IF EXISTS check_hgv_inspection_max_7_days;

ALTER TABLE hgv_inspections
  DROP CONSTRAINT IF EXISTS check_hgv_inspection_date_range;

ALTER TABLE hgv_inspections
  DROP CONSTRAINT IF EXISTS hgv_inspections_status_check;

-- Re-add daily constraints.
ALTER TABLE hgv_inspections
  ADD CONSTRAINT hgv_inspections_status_check
  CHECK (status = 'submitted');

ALTER TABLE hgv_inspections
  ADD CONSTRAINT check_hgv_inspection_daily_date
  CHECK (inspection_end_date = inspection_date);

-- Ensure no duplicate daily records are present before unique index.
DO $$
DECLARE
  duplicate_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO duplicate_count
  FROM (
    SELECT hgv_id, inspection_date
    FROM hgv_inspections
    WHERE hgv_id IS NOT NULL
    GROUP BY hgv_id, inspection_date
    HAVING COUNT(*) > 1
  ) duplicates;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION
      'Cannot enforce unique daily HGV inspections: % duplicate hgv_id/inspection_date groups exist',
      duplicate_count;
  END IF;
END $$;

DROP INDEX IF EXISTS idx_unique_hgv_inspection_date;
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_hgv_inspection_date
  ON hgv_inspections(hgv_id, inspection_date)
  WHERE hgv_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2) Extend child-table RLS checks to include hgv_inspections
-- -----------------------------------------------------------------------------

-- inspection_items
DROP POLICY IF EXISTS "Employees can view own inspection items" ON inspection_items;
CREATE POLICY "Employees can view own inspection items" ON inspection_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM van_inspections vi WHERE vi.id = inspection_items.inspection_id AND vi.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM plant_inspections pi WHERE pi.id = inspection_items.inspection_id AND pi.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM hgv_inspections hi WHERE hi.id = inspection_items.inspection_id AND hi.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Employees can insert own inspection items" ON inspection_items;
CREATE POLICY "Employees can insert own inspection items" ON inspection_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM van_inspections vi WHERE vi.id = inspection_items.inspection_id AND vi.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM plant_inspections pi WHERE pi.id = inspection_items.inspection_id AND pi.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM hgv_inspections hi WHERE hi.id = inspection_items.inspection_id AND hi.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Employees can update own inspection items" ON inspection_items;
CREATE POLICY "Employees can update own inspection items" ON inspection_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM van_inspections vi WHERE vi.id = inspection_items.inspection_id AND vi.user_id = auth.uid() AND vi.status = 'draft')
    OR EXISTS (SELECT 1 FROM plant_inspections pi WHERE pi.id = inspection_items.inspection_id AND pi.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM hgv_inspections hi WHERE hi.id = inspection_items.inspection_id AND hi.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Employees can delete own inspection items" ON inspection_items;
CREATE POLICY "Employees can delete own inspection items" ON inspection_items
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM van_inspections vi WHERE vi.id = inspection_items.inspection_id AND vi.user_id = auth.uid() AND vi.status = 'draft')
    OR EXISTS (SELECT 1 FROM plant_inspections pi WHERE pi.id = inspection_items.inspection_id AND pi.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM hgv_inspections hi WHERE hi.id = inspection_items.inspection_id AND hi.user_id = auth.uid())
  );

-- inspection_photos
DROP POLICY IF EXISTS "Users can manage own inspection photos" ON inspection_photos;
CREATE POLICY "Users can manage own inspection photos" ON inspection_photos
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM van_inspections vi WHERE vi.id = inspection_photos.inspection_id AND vi.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM plant_inspections pi WHERE pi.id = inspection_photos.inspection_id AND pi.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM hgv_inspections hi WHERE hi.id = inspection_photos.inspection_id AND hi.user_id = auth.uid())
  );

-- inspection_daily_hours
DROP POLICY IF EXISTS "Employees can view own inspection daily hours" ON inspection_daily_hours;
CREATE POLICY "Employees can view own inspection daily hours" ON inspection_daily_hours
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM van_inspections vi WHERE vi.id = inspection_daily_hours.inspection_id AND vi.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM plant_inspections pi WHERE pi.id = inspection_daily_hours.inspection_id AND pi.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM hgv_inspections hi WHERE hi.id = inspection_daily_hours.inspection_id AND hi.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Employees can insert own inspection daily hours" ON inspection_daily_hours;
CREATE POLICY "Employees can insert own inspection daily hours" ON inspection_daily_hours
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM van_inspections vi WHERE vi.id = inspection_daily_hours.inspection_id AND vi.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM plant_inspections pi WHERE pi.id = inspection_daily_hours.inspection_id AND pi.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM hgv_inspections hi WHERE hi.id = inspection_daily_hours.inspection_id AND hi.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Employees can update own inspection daily hours" ON inspection_daily_hours;
CREATE POLICY "Employees can update own inspection daily hours" ON inspection_daily_hours
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM van_inspections vi WHERE vi.id = inspection_daily_hours.inspection_id AND vi.user_id = auth.uid() AND vi.status = 'draft')
    OR EXISTS (SELECT 1 FROM plant_inspections pi WHERE pi.id = inspection_daily_hours.inspection_id AND pi.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM hgv_inspections hi WHERE hi.id = inspection_daily_hours.inspection_id AND hi.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Employees can delete own inspection daily hours" ON inspection_daily_hours;
CREATE POLICY "Employees can delete own inspection daily hours" ON inspection_daily_hours
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM van_inspections vi WHERE vi.id = inspection_daily_hours.inspection_id AND vi.user_id = auth.uid() AND vi.status = 'draft')
    OR EXISTS (SELECT 1 FROM plant_inspections pi WHERE pi.id = inspection_daily_hours.inspection_id AND pi.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM hgv_inspections hi WHERE hi.id = inspection_daily_hours.inspection_id AND hi.user_id = auth.uid())
  );

COMMIT;
