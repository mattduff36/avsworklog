-- =============================================================================
-- Fix Plant Table RLS Policies
-- =============================================================================
-- Problem: The plant table RLS policies use the deprecated profiles.role text
-- column pattern instead of the roles table with role_id FK. This causes all
-- write operations to fail with "new row violates row-level security policy"
-- because profiles.role is no longer a text column matching 'admin'/'manager'.
--
-- Also fixes: SELECT policy only allowed status IN ('active','maintenance'),
-- meaning retired plant records were invisible to everyone including admins.
-- =============================================================================

-- Drop all existing plant RLS policies
DROP POLICY IF EXISTS "plant_read_policy" ON plant;
DROP POLICY IF EXISTS "plant_insert_policy" ON plant;
DROP POLICY IF EXISTS "plant_update_policy" ON plant;
DROP POLICY IF EXISTS "plant_delete_policy" ON plant;

-- =============================================================================
-- Recreate policies using the correct roles table join pattern
-- =============================================================================

-- SELECT: All authenticated users can read active/maintenance plant.
-- Admins and managers can also see inactive/retired plant.
CREATE POLICY "plant_read_policy"
ON plant FOR SELECT
TO authenticated
USING (
  status IN ('active', 'maintenance')
  OR EXISTS (
    SELECT 1 FROM profiles p
    JOIN roles r ON p.role_id = r.id
    WHERE p.id = auth.uid()
    AND r.is_manager_admin = true
  )
);

-- INSERT: Admins and managers can create plant records
CREATE POLICY "plant_insert_policy"
ON plant FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles p
    JOIN roles r ON p.role_id = r.id
    WHERE p.id = auth.uid()
    AND r.is_manager_admin = true
  )
);

-- UPDATE: Admins and managers can update plant records (including retiring)
CREATE POLICY "plant_update_policy"
ON plant FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles p
    JOIN roles r ON p.role_id = r.id
    WHERE p.id = auth.uid()
    AND r.is_manager_admin = true
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles p
    JOIN roles r ON p.role_id = r.id
    WHERE p.id = auth.uid()
    AND r.is_manager_admin = true
  )
);

-- DELETE: Only admins (super admin) can permanently delete plant records
CREATE POLICY "plant_delete_policy"
ON plant FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles p
    JOIN roles r ON p.role_id = r.id
    WHERE p.id = auth.uid()
    AND r.is_super_admin = true
  )
);
