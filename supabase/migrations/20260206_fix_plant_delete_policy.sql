-- =============================================================================
-- Fix Plant DELETE RLS Policy
-- =============================================================================
-- The DELETE policy previously required is_super_admin, but the UI allows
-- admins and managers to permanently remove retired plant records.
-- Supabase silently returns success (0 rows affected) when RLS blocks a
-- DELETE, so the client-side code appeared to succeed but never actually
-- removed the row. Align DELETE with the same is_manager_admin check used
-- by INSERT and UPDATE.
-- =============================================================================

DROP POLICY IF EXISTS "plant_delete_policy" ON plant;

CREATE POLICY "plant_delete_policy"
ON plant FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles p
    JOIN roles r ON p.role_id = r.id
    WHERE p.id = auth.uid()
    AND r.is_manager_admin = true
  )
);
