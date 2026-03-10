-- Fix: allow manager/admin users to create absences for other employees.
-- Root cause: absences table had manager SELECT/UPDATE policies but no manager INSERT policy.

DROP POLICY IF EXISTS "Managers can create absences" ON absences;

CREATE POLICY "Managers can create absences" ON absences
FOR INSERT
TO authenticated
WITH CHECK (effective_is_manager_admin());
