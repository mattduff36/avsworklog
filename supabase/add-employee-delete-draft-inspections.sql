-- Add DELETE policy for employees to delete their own draft inspections
-- Date: 2025-11-27

-- Add DELETE policy for vehicle_inspections
-- Allows employees to delete ONLY their own draft inspections
CREATE POLICY "Employees can delete own draft inspections" ON vehicle_inspections
  FOR DELETE USING (
    auth.uid() = user_id
    AND status = 'draft'
  );

-- Verify the policy was created
SELECT 
  schemaname, 
  tablename, 
  policyname, 
  cmd as operation,
  qual as using_expression
FROM pg_policies 
WHERE tablename = 'vehicle_inspections'
ORDER BY cmd, policyname;

