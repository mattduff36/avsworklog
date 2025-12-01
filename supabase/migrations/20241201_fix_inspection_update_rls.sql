-- Fix vehicle_inspections UPDATE policy to allow updating draft inspections
-- Currently employees can only update 'in_progress' and 'submitted' inspections
-- but they need to be able to update 'draft' inspections too

-- Drop the old policy
DROP POLICY IF EXISTS "Employees can update own inspections" ON vehicle_inspections;

-- Create new policy that includes 'draft' status
CREATE POLICY "Employees can update own inspections" ON vehicle_inspections
  FOR UPDATE
  TO authenticated
  USING (
    (auth.uid() = user_id) AND 
    (status = ANY (ARRAY['draft'::text, 'in_progress'::text, 'submitted'::text, 'rejected'::text]))
  );

-- Note: Also added 'rejected' status so users can update rejected inspections too

