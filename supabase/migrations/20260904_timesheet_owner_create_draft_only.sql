-- finalise-phase: predeploy
-- Align owner timesheet INSERT with authoriser create: draft or rejected only.
-- Stops browser clients inserting a submitted header before entries.

BEGIN;

DROP POLICY IF EXISTS "Users can create own timesheets" ON public.timesheets;
CREATE POLICY "Users can create own timesheets"
  ON public.timesheets
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND status = ANY (ARRAY['draft'::text, 'rejected'::text])
  );

COMMIT;
