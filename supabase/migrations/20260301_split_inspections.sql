-- =============================================================================
-- Split vehicle_inspections → van_inspections + plant_inspections
-- =============================================================================
-- Single-transaction migration that:
--   1. Validates data integrity (fail-fast)
--   2. Creates plant_inspections table
--   3. Drops FK constraints from child tables
--   4. Renames vehicle_inspections → van_inspections
--   5. Moves plant/hired-plant rows to plant_inspections
--   6. Updates constraints on both tables
--   7. Sets up RLS, triggers, indexes on plant_inspections
--   8. Updates child-table RLS to reference both parents
--   9. Creates vehicle_inspections compatibility view
-- =============================================================================

BEGIN;

-- =========================================================================
-- SECTION 1: PREFLIGHT — fail transaction if dirty data exists
-- =========================================================================

DO $$
DECLARE
  dirty_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO dirty_count
  FROM vehicle_inspections
  WHERE NOT (
    (vehicle_id IS NOT NULL AND plant_id IS NULL AND is_hired_plant = FALSE)
    OR (vehicle_id IS NULL AND plant_id IS NOT NULL AND is_hired_plant = FALSE)
    OR (vehicle_id IS NULL AND plant_id IS NULL AND is_hired_plant = TRUE)
  );

  IF dirty_count > 0 THEN
    RAISE EXCEPTION 'PREFLIGHT FAILED: % rows do not match van/plant/hired classification', dirty_count;
  END IF;
END $$;

-- =========================================================================
-- SECTION 2: CREATE plant_inspections TABLE
-- =========================================================================

CREATE TABLE plant_inspections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID NULL,
  plant_id UUID REFERENCES plant(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id),
  inspection_date DATE NOT NULL,
  inspection_end_date DATE NULL,
  current_mileage INTEGER NULL,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted')),
  submitted_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  manager_comments TEXT,
  inspector_comments TEXT,
  signature_data TEXT,
  signed_at TIMESTAMPTZ,
  is_hired_plant BOOLEAN NOT NULL DEFAULT FALSE,
  hired_plant_id_serial TEXT,
  hired_plant_description TEXT,
  hired_plant_hiring_company TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE plant_inspections IS 'Plant machinery inspections (owned and hired)';

-- =========================================================================
-- SECTION 3: DROP FK CONSTRAINTS FROM CHILD TABLES
-- =========================================================================
-- Must happen BEFORE rename + data move to prevent CASCADE deletes.

ALTER TABLE inspection_items
  DROP CONSTRAINT IF EXISTS inspection_items_inspection_id_fkey;

ALTER TABLE inspection_photos
  DROP CONSTRAINT IF EXISTS inspection_photos_inspection_id_fkey;

ALTER TABLE inspection_daily_hours
  DROP CONSTRAINT IF EXISTS inspection_daily_hours_inspection_id_fkey;

ALTER TABLE actions
  DROP CONSTRAINT IF EXISTS actions_inspection_id_fkey;

-- =========================================================================
-- SECTION 4: RENAME vehicle_inspections → van_inspections
-- =========================================================================

ALTER TABLE vehicle_inspections RENAME TO van_inspections;

-- Rename the PK constraint for clarity (optional but nice)
DO $$
BEGIN
  ALTER INDEX IF EXISTS vehicle_inspections_pkey RENAME TO van_inspections_pkey;
EXCEPTION WHEN undefined_object THEN
  NULL; -- ignore if already renamed or doesn't exist
END $$;

-- =========================================================================
-- SECTION 5: MOVE PLANT/HIRED-PLANT DATA → plant_inspections
-- =========================================================================

INSERT INTO plant_inspections (
  id, vehicle_id, plant_id, user_id,
  inspection_date, inspection_end_date, current_mileage,
  status, submitted_at, reviewed_by, reviewed_at,
  manager_comments, inspector_comments, signature_data, signed_at,
  is_hired_plant, hired_plant_id_serial, hired_plant_description, hired_plant_hiring_company,
  created_at, updated_at
)
SELECT
  id, vehicle_id, plant_id, user_id,
  inspection_date, inspection_end_date, current_mileage,
  status, submitted_at, reviewed_by, reviewed_at,
  manager_comments, inspector_comments, signature_data, signed_at,
  is_hired_plant, hired_plant_id_serial, hired_plant_description, hired_plant_hiring_company,
  created_at, updated_at
FROM van_inspections
WHERE plant_id IS NOT NULL OR is_hired_plant = TRUE;

DELETE FROM van_inspections
WHERE plant_id IS NOT NULL OR is_hired_plant = TRUE;

-- =========================================================================
-- SECTION 6: TIGHTEN CONSTRAINTS ON BOTH TABLES
-- =========================================================================

-- van_inspections: drop the old 3-way asset check, add van-only check
ALTER TABLE van_inspections DROP CONSTRAINT IF EXISTS check_inspections_asset;
ALTER TABLE van_inspections DROP CONSTRAINT IF EXISTS check_plant_inspections_not_draft;
ALTER TABLE van_inspections DROP CONSTRAINT IF EXISTS vehicle_inspections_status_check;

ALTER TABLE van_inspections
  ADD CONSTRAINT van_inspections_status_check CHECK (status IN ('draft', 'submitted'));

ALTER TABLE van_inspections
  ADD CONSTRAINT van_inspections_is_van CHECK (
    vehicle_id IS NOT NULL
    AND plant_id IS NULL
    AND is_hired_plant = FALSE
  );

-- plant_inspections: add plant-only check, no-draft check
ALTER TABLE plant_inspections
  ADD CONSTRAINT plant_inspections_is_plant CHECK (
    (vehicle_id IS NULL AND plant_id IS NOT NULL AND is_hired_plant = FALSE)
    OR
    (vehicle_id IS NULL AND plant_id IS NULL AND is_hired_plant = TRUE
     AND hired_plant_id_serial IS NOT NULL AND length(trim(hired_plant_id_serial)) > 0
     AND hired_plant_description IS NOT NULL AND length(trim(hired_plant_description)) > 0
     AND hired_plant_hiring_company IS NOT NULL AND length(trim(hired_plant_hiring_company)) > 0)
  );

ALTER TABLE plant_inspections
  ADD CONSTRAINT plant_inspections_not_draft CHECK (status <> 'draft');

-- =========================================================================
-- SECTION 7: INDEXES ON plant_inspections
-- =========================================================================

CREATE INDEX idx_plant_inspections_plant_id
  ON plant_inspections(plant_id) WHERE plant_id IS NOT NULL;

CREATE INDEX idx_plant_inspections_user_id
  ON plant_inspections(user_id);

CREATE INDEX idx_plant_inspections_date
  ON plant_inspections(inspection_date);

CREATE INDEX idx_plant_inspections_is_hired_plant
  ON plant_inspections(is_hired_plant) WHERE is_hired_plant = TRUE;

CREATE UNIQUE INDEX idx_unique_plant_inspection_date_new
  ON plant_inspections(plant_id, inspection_date) WHERE plant_id IS NOT NULL;

CREATE UNIQUE INDEX idx_unique_hired_plant_inspection_date_new
  ON plant_inspections(inspection_date, hired_plant_id_serial) WHERE is_hired_plant = TRUE;

-- =========================================================================
-- SECTION 8: RLS ON plant_inspections
-- =========================================================================

ALTER TABLE plant_inspections ENABLE ROW LEVEL SECURITY;

-- SELECT
CREATE POLICY "Employees can view own plant inspections" ON plant_inspections
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Managers can view all plant inspections" ON plant_inspections
  FOR SELECT TO authenticated
  USING (effective_is_manager_admin());

-- INSERT
CREATE POLICY "Employees can create own plant inspections" ON plant_inspections
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Managers can create plant inspections for users" ON plant_inspections
  FOR INSERT TO authenticated
  WITH CHECK (effective_is_manager_admin());

-- UPDATE (plant inspections are never draft, so update is manager-only)
CREATE POLICY "Managers can update plant inspections" ON plant_inspections
  FOR UPDATE TO authenticated
  USING (effective_is_manager_admin());

-- DELETE
CREATE POLICY "Managers and admins can delete plant inspections" ON plant_inspections
  FOR DELETE TO authenticated
  USING (effective_is_manager_admin());

-- =========================================================================
-- SECTION 9: UPDATE van_inspections RLS (remove plant guards)
-- =========================================================================
-- Current UPDATE policies have "AND plant_id IS NULL AND is_hired_plant = FALSE"
-- which is always true now but let's simplify for clarity.

DROP POLICY IF EXISTS "Employees can update own inspections" ON van_inspections;
CREATE POLICY "Employees can update own inspections" ON van_inspections
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND status = 'draft')
  WITH CHECK (auth.uid() = user_id AND status IN ('draft', 'submitted'));

DROP POLICY IF EXISTS "Managers can update inspections" ON van_inspections
;
CREATE POLICY "Managers can update inspections" ON van_inspections
  FOR UPDATE TO authenticated
  USING (effective_is_manager_admin() AND status = 'draft')
  WITH CHECK (effective_is_manager_admin() AND status IN ('draft', 'submitted'));

-- =========================================================================
-- SECTION 10: TRIGGERS ON plant_inspections
-- =========================================================================

-- updated_at trigger
CREATE TRIGGER set_updated_at_plant_inspections
  BEFORE UPDATE ON plant_inspections
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- audit logging trigger (reuses existing generic function)
CREATE TRIGGER audit_plant_inspections
  AFTER INSERT OR UPDATE OR DELETE ON plant_inspections
  FOR EACH ROW EXECUTE FUNCTION log_audit_changes();

-- =========================================================================
-- SECTION 11: UPDATE CHILD-TABLE RLS TO CHECK BOTH PARENTS
-- =========================================================================

-- ---- inspection_items ----

DROP POLICY IF EXISTS "Employees can view own inspection items" ON inspection_items;
CREATE POLICY "Employees can view own inspection items" ON inspection_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM van_inspections vi WHERE vi.id = inspection_items.inspection_id AND vi.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM plant_inspections pi WHERE pi.id = inspection_items.inspection_id AND pi.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Employees can insert own inspection items" ON inspection_items;
CREATE POLICY "Employees can insert own inspection items" ON inspection_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM van_inspections vi WHERE vi.id = inspection_items.inspection_id AND vi.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM plant_inspections pi WHERE pi.id = inspection_items.inspection_id AND pi.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Employees can update own inspection items" ON inspection_items;
CREATE POLICY "Employees can update own inspection items" ON inspection_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM van_inspections vi WHERE vi.id = inspection_items.inspection_id AND vi.user_id = auth.uid() AND vi.status = 'draft')
    OR EXISTS (SELECT 1 FROM plant_inspections pi WHERE pi.id = inspection_items.inspection_id AND pi.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Employees can delete own inspection items" ON inspection_items;
CREATE POLICY "Employees can delete own inspection items" ON inspection_items
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM van_inspections vi WHERE vi.id = inspection_items.inspection_id AND vi.user_id = auth.uid() AND vi.status = 'draft')
    OR EXISTS (SELECT 1 FROM plant_inspections pi WHERE pi.id = inspection_items.inspection_id AND pi.user_id = auth.uid())
  );

-- Manager policies on inspection_items don't reference parent table, no change needed.

-- ---- inspection_photos ----

DROP POLICY IF EXISTS "Users can manage own inspection photos" ON inspection_photos;
CREATE POLICY "Users can manage own inspection photos" ON inspection_photos
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM van_inspections vi WHERE vi.id = inspection_photos.inspection_id AND vi.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM plant_inspections pi WHERE pi.id = inspection_photos.inspection_id AND pi.user_id = auth.uid())
  );

-- ---- inspection_daily_hours ----

DROP POLICY IF EXISTS "Employees can view own inspection daily hours" ON inspection_daily_hours;
CREATE POLICY "Employees can view own inspection daily hours" ON inspection_daily_hours
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM van_inspections vi WHERE vi.id = inspection_daily_hours.inspection_id AND vi.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM plant_inspections pi WHERE pi.id = inspection_daily_hours.inspection_id AND pi.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Employees can insert own inspection daily hours" ON inspection_daily_hours;
CREATE POLICY "Employees can insert own inspection daily hours" ON inspection_daily_hours
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM van_inspections vi WHERE vi.id = inspection_daily_hours.inspection_id AND vi.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM plant_inspections pi WHERE pi.id = inspection_daily_hours.inspection_id AND pi.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Employees can update own inspection daily hours" ON inspection_daily_hours;
CREATE POLICY "Employees can update own inspection daily hours" ON inspection_daily_hours
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM van_inspections vi WHERE vi.id = inspection_daily_hours.inspection_id AND vi.user_id = auth.uid() AND vi.status = 'draft')
    OR EXISTS (SELECT 1 FROM plant_inspections pi WHERE pi.id = inspection_daily_hours.inspection_id AND pi.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Employees can delete own inspection daily hours" ON inspection_daily_hours;
CREATE POLICY "Employees can delete own inspection daily hours" ON inspection_daily_hours
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM van_inspections vi WHERE vi.id = inspection_daily_hours.inspection_id AND vi.user_id = auth.uid() AND vi.status = 'draft')
    OR EXISTS (SELECT 1 FROM plant_inspections pi WHERE pi.id = inspection_daily_hours.inspection_id AND pi.user_id = auth.uid())
  );

-- Manager policies on daily_hours don't reference parent table, no change needed.

-- =========================================================================
-- SECTION 12: COMPATIBILITY VIEW (read-only, transition period only)
-- =========================================================================

CREATE OR REPLACE VIEW vehicle_inspections AS
  SELECT *, 'van'::text AS inspection_kind FROM van_inspections
  UNION ALL
  SELECT *, 'plant'::text AS inspection_kind FROM plant_inspections;

COMMENT ON VIEW vehicle_inspections IS 'Temporary compatibility view – remove after code cutover';

-- =========================================================================
-- SECTION 13: VERIFY DATA INTEGRITY
-- =========================================================================

DO $$
DECLARE
  van_count   BIGINT;
  plant_count BIGINT;
  view_count  BIGINT;
BEGIN
  SELECT COUNT(*) INTO van_count   FROM van_inspections;
  SELECT COUNT(*) INTO plant_count FROM plant_inspections;
  SELECT COUNT(*) INTO view_count  FROM vehicle_inspections;

  IF view_count <> (van_count + plant_count) THEN
    RAISE EXCEPTION 'DATA INTEGRITY FAILED: view has % rows but tables have %+%=%',
      view_count, van_count, plant_count, van_count + plant_count;
  END IF;

  RAISE NOTICE 'Split complete — van: %, plant: %, total: %', van_count, plant_count, view_count;
END $$;

COMMIT;
