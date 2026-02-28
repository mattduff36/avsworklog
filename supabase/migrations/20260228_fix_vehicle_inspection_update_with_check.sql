-- Fix: Allow vehicle inspection status to transition from 'draft' to 'submitted'
-- 
-- Problem: The UPDATE RLS policies on vehicle_inspections use USING(status = 'draft')
-- without an explicit WITH CHECK clause. PostgreSQL uses USING as WITH CHECK when
-- none is specified, which means the updated row must ALSO have status = 'draft'.
-- This blocks users from submitting inspections (changing status to 'submitted').
--
-- Fix: Add explicit WITH CHECK clauses that allow status to be 'draft' or 'submitted'.

BEGIN;

-- Employee update policy
DROP POLICY IF EXISTS "Employees can update own inspections" ON vehicle_inspections;

CREATE POLICY "Employees can update own inspections" ON vehicle_inspections
  FOR UPDATE
  TO authenticated
  USING (
    (auth.uid() = user_id)
    AND status = 'draft'
    AND plant_id IS NULL
    AND is_hired_plant = FALSE
  )
  WITH CHECK (
    (auth.uid() = user_id)
    AND status IN ('draft', 'submitted')
    AND plant_id IS NULL
    AND is_hired_plant = FALSE
  );

-- Manager update policy
DROP POLICY IF EXISTS "Managers can update inspections" ON vehicle_inspections;

CREATE POLICY "Managers can update inspections" ON vehicle_inspections
  FOR UPDATE
  TO authenticated
  USING (
    effective_is_manager_admin()
    AND status = 'draft'
    AND plant_id IS NULL
    AND is_hired_plant = FALSE
  )
  WITH CHECK (
    effective_is_manager_admin()
    AND status IN ('draft', 'submitted')
    AND plant_id IS NULL
    AND is_hired_plant = FALSE
  );

COMMIT;
