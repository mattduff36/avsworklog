-- Add missing DELETE policy for inspection_items
-- This fixes the issue where users cannot re-save draft inspections
-- Date: 2025-11-27

-- Add DELETE policy for inspection_items
-- Allows users to delete items from their own inspections (drafts and rejected)
CREATE POLICY "Employees can delete own inspection items" ON inspection_items
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM vehicle_inspections vi
      WHERE vi.id = inspection_items.inspection_id
      AND vi.user_id = auth.uid()
      AND vi.status IN ('draft', 'rejected')
    )
  );

-- Verify the policy was created
SELECT 
  schemaname, 
  tablename, 
  policyname, 
  cmd as operation,
  qual as using_expression
FROM pg_policies 
WHERE tablename = 'inspection_items'
ORDER BY cmd;

