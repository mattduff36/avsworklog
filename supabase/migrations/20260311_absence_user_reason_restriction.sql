BEGIN;

DROP POLICY IF EXISTS "Users can create own absences" ON absences;

CREATE POLICY "Users can create own absences" ON absences
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = profile_id
  AND auth.uid() = created_by
  AND EXISTS (
    SELECT 1
    FROM absence_reasons ar
    WHERE ar.id = reason_id
      AND ar.is_active = true
      AND lower(ar.name) IN ('annual leave', 'unpaid leave')
  )
);

COMMIT;
