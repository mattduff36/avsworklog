-- =============================================================================
-- Harden roles INSERT policy for manager actors (data-level constraints)
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS "Only admins can insert roles" ON roles;
CREATE POLICY "Only admins can insert roles" ON roles
FOR INSERT TO authenticated
WITH CHECK (
  (effective_is_super_admin() OR effective_has_role_name('admin'))
  OR (
    effective_is_manager_admin()
    AND COALESCE(is_super_admin, FALSE) = FALSE
    AND COALESCE(is_manager_admin, FALSE) = FALSE
    AND COALESCE(name, '') <> 'admin'
  )
);

DO $$
BEGIN
  RAISE NOTICE 'Applied roles INSERT policy hardening for manager actor.';
END $$;

COMMIT;
