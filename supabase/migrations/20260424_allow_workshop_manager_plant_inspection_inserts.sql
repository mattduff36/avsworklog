BEGIN;

DROP POLICY IF EXISTS "Managers can create plant inspections for users" ON public.plant_inspections;
CREATE POLICY "Managers can create plant inspections for users"
  ON public.plant_inspections
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT effective_is_manager_admin()));

COMMIT;
