-- =============================================================================
-- Fix manager-flag based role assignment and role/permission INSERT policies
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.effective_can_assign_role(target_role_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  eff_role_id UUID;
  eff_role_name TEXT;
  eff_is_super BOOLEAN;
  eff_is_manager BOOLEAN;
  target_role_name TEXT;
  target_is_manager BOOLEAN;
BEGIN
  eff_role_id := effective_role_id();
  IF eff_role_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT r.name, r.is_super_admin, r.is_manager_admin
  INTO eff_role_name, eff_is_super, eff_is_manager
  FROM roles r
  WHERE r.id = eff_role_id;

  IF eff_is_super OR eff_role_name = 'admin' THEN
    RETURN TRUE;
  END IF;

  IF COALESCE(eff_is_manager, FALSE) THEN
    SELECT name, COALESCE(is_manager_admin, FALSE)
    INTO target_role_name, target_is_manager
    FROM roles
    WHERE id = target_role_id;

    RETURN COALESCE(target_role_name LIKE 'employee-%', FALSE)
       AND target_is_manager = FALSE;
  END IF;

  RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

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

DROP POLICY IF EXISTS "Only admins can insert permissions" ON role_permissions;
CREATE POLICY "Only admins can insert permissions" ON role_permissions
FOR INSERT TO authenticated
WITH CHECK (effective_is_super_admin() OR effective_has_role_name('admin') OR effective_is_manager_admin());

DO $$
BEGIN
  RAISE NOTICE 'Applied manager assignment + insert policy fix.';
END $$;

COMMIT;
