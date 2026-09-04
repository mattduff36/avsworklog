-- finalise-phase: predeploy
BEGIN;

DROP POLICY IF EXISTS "Managers can delete assignments" ON public.rams_assignments;

CREATE POLICY "Managers can delete assignments"
  ON public.rams_assignments
  FOR DELETE
  TO authenticated
  USING ((SELECT public.effective_has_module_level('rams', 4)));

COMMIT;
