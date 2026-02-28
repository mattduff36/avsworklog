-- Fix: Allow van inspection status to transition from 'draft' to 'submitted'
-- 
-- Problem: The UPDATE RLS policies on van_inspections use USING(status = 'draft')
-- without an explicit WITH CHECK clause. PostgreSQL uses USING as WITH CHECK when
-- none is specified, which means the updated row must ALSO have status = 'draft'.
-- This blocks users from submitting inspections (changing status to 'submitted').
--
-- Fix: Add explicit WITH CHECK clauses that allow status to be 'draft' or 'submitted'.
-- Note: plant_id/is_hired_plant guards removed since van_inspections only contains van rows.

BEGIN;

-- Employee update policy
DROP POLICY IF EXISTS "Employees can update own inspections" ON van_inspections;

CREATE POLICY "Employees can update own inspections" ON van_inspections
  FOR UPDATE
  TO authenticated
  USING (
    (auth.uid() = user_id)
    AND status = 'draft'
  )
  WITH CHECK (
    (auth.uid() = user_id)
    AND status IN ('draft', 'submitted')
  );

-- Manager update policy
DROP POLICY IF EXISTS "Managers can update inspections" ON van_inspections;

CREATE POLICY "Managers can update inspections" ON van_inspections
  FOR UPDATE
  TO authenticated
  USING (
    effective_is_manager_admin()
    AND status = 'draft'
  )
  WITH CHECK (
    effective_is_manager_admin()
    AND status IN ('draft', 'submitted')
  );

COMMIT;
