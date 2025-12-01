-- Simplify vehicle_inspections status workflow
-- - Collapse statuses to just 'draft' and 'submitted'
-- - Migrate existing non-draft inspections to 'submitted'
-- - Tighten RLS so only draft inspections are updatable

BEGIN;

-- 1) Migrate existing data: map legacy statuses to 'submitted'
UPDATE vehicle_inspections
SET status = 'submitted'
WHERE status IN ('pending', 'approved', 'rejected', 'reviewed', 'in_progress');

-- 2) Ensure any NULL status defaults to 'draft'
UPDATE vehicle_inspections
SET status = 'draft'
WHERE status IS NULL;

-- 3) Optionally, keep a consistent CHECK constraint if present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.constraint_column_usage ccu
    WHERE ccu.table_name = 'vehicle_inspections'
      AND ccu.column_name = 'status'
  ) THEN
    BEGIN
      ALTER TABLE vehicle_inspections
      DROP CONSTRAINT IF EXISTS vehicle_inspections_status_check;

      ALTER TABLE vehicle_inspections
      ADD CONSTRAINT vehicle_inspections_status_check
      CHECK (status IN ('draft', 'submitted'));
    EXCEPTION
      WHEN undefined_object THEN
        -- If the constraint name doesn't exist, skip changing it
        NULL;
    END;
  END IF;
END $$;

-- 4) Tighten RLS so only draft inspections are updatable by employees
DROP POLICY IF EXISTS "Employees can update own inspections" ON vehicle_inspections;

CREATE POLICY "Employees can update own inspections" ON vehicle_inspections
  FOR UPDATE
  TO authenticated
  USING (
    (auth.uid() = user_id)
    AND status = 'draft'
  );

-- 5) Restrict manager updates to draft inspections as well
DROP POLICY IF EXISTS "Managers can update inspections" ON vehicle_inspections;

CREATE POLICY "Managers can update inspections" ON vehicle_inspections
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role IN ('manager', 'admin')
    )
    AND status = 'draft'
  );

COMMIT;


