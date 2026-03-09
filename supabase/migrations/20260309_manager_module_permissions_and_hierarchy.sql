-- =============================================================================
-- Manager module-based permissions + assignment hierarchy helpers
-- =============================================================================

BEGIN;

-- Keep Admin as full-access, but make Manager module-based.
CREATE OR REPLACE FUNCTION public.effective_has_module_permission(module TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  eff_role UUID;
BEGIN
  eff_role := effective_role_id();
  IF eff_role IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Super admin and Admin always have full access.
  IF EXISTS (
    SELECT 1
    FROM roles
    WHERE id = eff_role
      AND (is_super_admin = TRUE OR name = 'admin')
  ) THEN
    RETURN TRUE;
  END IF;

  -- Managers and employees are module-driven.
  RETURN EXISTS (
    SELECT 1
    FROM role_permissions
    WHERE role_id = eff_role
      AND module_name = module
      AND enabled = TRUE
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

-- Hierarchy helper:
--   - Admin / super-admin can assign any role.
--   - Manager can assign employee-* roles only.
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

-- ---------------------------------------------------------------------------
-- Module-specific policy updates
-- ---------------------------------------------------------------------------

-- customers
DROP POLICY IF EXISTS "customers_select" ON customers;
DROP POLICY IF EXISTS "customers_insert" ON customers;
DROP POLICY IF EXISTS "customers_update" ON customers;
DROP POLICY IF EXISTS "customers_delete" ON customers;

CREATE POLICY "customers_select" ON customers
  FOR SELECT USING (effective_has_module_permission('customers'));
CREATE POLICY "customers_insert" ON customers
  FOR INSERT WITH CHECK (effective_has_module_permission('customers'));
CREATE POLICY "customers_update" ON customers
  FOR UPDATE USING (effective_has_module_permission('customers'))
  WITH CHECK (effective_has_module_permission('customers'));
CREATE POLICY "customers_delete" ON customers
  FOR DELETE USING (effective_is_super_admin() OR effective_has_role_name('admin'));

-- quote_sequences
DROP POLICY IF EXISTS "quote_sequences_select" ON quote_sequences;
DROP POLICY IF EXISTS "quote_sequences_insert" ON quote_sequences;
DROP POLICY IF EXISTS "quote_sequences_update" ON quote_sequences;

CREATE POLICY "quote_sequences_select" ON quote_sequences
  FOR SELECT USING (effective_has_module_permission('quotes'));
CREATE POLICY "quote_sequences_insert" ON quote_sequences
  FOR INSERT WITH CHECK (effective_has_module_permission('quotes'));
CREATE POLICY "quote_sequences_update" ON quote_sequences
  FOR UPDATE USING (effective_has_module_permission('quotes'))
  WITH CHECK (effective_has_module_permission('quotes'));

-- quotes
DROP POLICY IF EXISTS "quotes_select" ON quotes;
DROP POLICY IF EXISTS "quotes_insert" ON quotes;
DROP POLICY IF EXISTS "quotes_update" ON quotes;
DROP POLICY IF EXISTS "quotes_delete" ON quotes;

CREATE POLICY "quotes_select" ON quotes
  FOR SELECT USING (effective_has_module_permission('quotes'));
CREATE POLICY "quotes_insert" ON quotes
  FOR INSERT WITH CHECK (effective_has_module_permission('quotes'));
CREATE POLICY "quotes_update" ON quotes
  FOR UPDATE USING (effective_has_module_permission('quotes'))
  WITH CHECK (effective_has_module_permission('quotes'));
CREATE POLICY "quotes_delete" ON quotes
  FOR DELETE USING (effective_is_super_admin() OR effective_has_role_name('admin'));

-- quote_line_items
DROP POLICY IF EXISTS "quote_line_items_select" ON quote_line_items;
DROP POLICY IF EXISTS "quote_line_items_insert" ON quote_line_items;
DROP POLICY IF EXISTS "quote_line_items_update" ON quote_line_items;
DROP POLICY IF EXISTS "quote_line_items_delete" ON quote_line_items;

CREATE POLICY "quote_line_items_select" ON quote_line_items
  FOR SELECT USING (effective_has_module_permission('quotes'));
CREATE POLICY "quote_line_items_insert" ON quote_line_items
  FOR INSERT WITH CHECK (effective_has_module_permission('quotes'));
CREATE POLICY "quote_line_items_update" ON quote_line_items
  FOR UPDATE USING (effective_has_module_permission('quotes'))
  WITH CHECK (effective_has_module_permission('quotes'));
CREATE POLICY "quote_line_items_delete" ON quote_line_items
  FOR DELETE USING (effective_has_module_permission('quotes'));

-- suggestions
DROP POLICY IF EXISTS "Managers can view all suggestions" ON suggestions;
DROP POLICY IF EXISTS "Managers can update suggestions" ON suggestions;
CREATE POLICY "Managers can view all suggestions" ON suggestions
FOR SELECT USING (effective_has_module_permission('suggestions'));
CREATE POLICY "Managers can update suggestions" ON suggestions
FOR UPDATE USING (effective_has_module_permission('suggestions'));

-- suggestion updates
DROP POLICY IF EXISTS "Managers can view all suggestion updates" ON suggestion_updates;
DROP POLICY IF EXISTS "Managers can create suggestion updates" ON suggestion_updates;
CREATE POLICY "Managers can view all suggestion updates" ON suggestion_updates
FOR SELECT USING (effective_has_module_permission('suggestions'));
CREATE POLICY "Managers can create suggestion updates" ON suggestion_updates
FOR INSERT WITH CHECK (effective_has_module_permission('suggestions'));

-- FAQ editor
DROP POLICY IF EXISTS "Admins can manage FAQ categories" ON faq_categories;
DROP POLICY IF EXISTS "Admins can manage FAQ articles" ON faq_articles;
CREATE POLICY "Admins can manage FAQ categories" ON faq_categories
FOR ALL USING (effective_has_module_permission('faq-editor'));
CREATE POLICY "Admins can manage FAQ articles" ON faq_articles
FOR ALL USING (effective_has_module_permission('faq-editor'));

-- Error reports management
DROP POLICY IF EXISTS "Admins can view all error reports" ON error_reports;
DROP POLICY IF EXISTS "Admins can update error reports" ON error_reports;
CREATE POLICY "Admins can view all error reports" ON error_reports
FOR SELECT USING (effective_has_module_permission('error-reports'));
CREATE POLICY "Admins can update error reports" ON error_reports
FOR UPDATE USING (effective_has_module_permission('error-reports'));

DROP POLICY IF EXISTS "Admins can view all error report updates" ON error_report_updates;
DROP POLICY IF EXISTS "Admins can create error report updates" ON error_report_updates;
CREATE POLICY "Admins can view all error report updates" ON error_report_updates
FOR SELECT USING (effective_has_module_permission('error-reports'));
CREATE POLICY "Admins can create error report updates" ON error_report_updates
FOR INSERT WITH CHECK (effective_has_module_permission('error-reports'));

-- RBAC tables should remain Admin/super-admin managed.
DROP POLICY IF EXISTS "Only admins can insert roles" ON roles;
DROP POLICY IF EXISTS "Only admins can update roles" ON roles;
DROP POLICY IF EXISTS "Only admins can delete roles" ON roles;
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
CREATE POLICY "Only admins can update roles" ON roles
FOR UPDATE TO authenticated
USING (effective_is_super_admin() OR effective_has_role_name('admin'));
CREATE POLICY "Only admins can delete roles" ON roles
FOR DELETE TO authenticated
USING ((effective_is_super_admin() OR effective_has_role_name('admin')) AND NOT is_super_admin);

DROP POLICY IF EXISTS "Only admins can insert permissions" ON role_permissions;
DROP POLICY IF EXISTS "Only admins can update permissions" ON role_permissions;
DROP POLICY IF EXISTS "Only admins can delete permissions" ON role_permissions;
CREATE POLICY "Only admins can insert permissions" ON role_permissions
FOR INSERT TO authenticated
WITH CHECK (effective_is_super_admin() OR effective_has_role_name('admin') OR effective_is_manager_admin());
CREATE POLICY "Only admins can update permissions" ON role_permissions
FOR UPDATE TO authenticated
USING (effective_is_super_admin() OR effective_has_role_name('admin'));
CREATE POLICY "Only admins can delete permissions" ON role_permissions
FOR DELETE TO authenticated
USING (effective_is_super_admin() OR effective_has_role_name('admin'));

DO $$
BEGIN
  RAISE NOTICE 'Applied manager module-permission RBAC migration.';
END $$;

COMMIT;
