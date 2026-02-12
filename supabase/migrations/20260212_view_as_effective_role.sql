-- =============================================================================
-- View As: Effective Role Functions & RLS Policy Updates
-- =============================================================================
-- Adds helper functions that let a SuperAdmin "view as" any role.
-- When the x-view-as-role-id header is present and the caller is an actual
-- super admin, all permission checks use the OVERRIDE role instead of the
-- caller's real role. For every other user the behaviour is unchanged.
--
-- Part 1 – Helper functions
-- Part 2 – Update existing RBAC helper functions
-- Part 3 – Rewrite RLS policies to use the new helpers
-- =============================================================================

BEGIN;

-- ============================================================================
-- PART 1: HELPER FUNCTIONS
-- ============================================================================

-- 1a) Extract the override role-id from the PostgREST request headers.
--     Returns NULL when the header is absent, empty, or unparseable.
CREATE OR REPLACE FUNCTION public.view_as_role_id()
RETURNS UUID AS $$
DECLARE
  headers_json TEXT;
  role_id_str  TEXT;
BEGIN
  headers_json := current_setting('request.headers', true);
  IF headers_json IS NULL OR headers_json = '' THEN
    RETURN NULL;
  END IF;
  role_id_str := headers_json::json ->> 'x-view-as-role-id';
  IF role_id_str IS NULL OR role_id_str = '' THEN
    RETURN NULL;
  END IF;
  RETURN role_id_str::uuid;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

-- 1b) Is the ACTUAL caller (auth.uid()) a super admin?
--     This intentionally ignores the view-as override – it checks
--     the real profile / role flags.
CREATE OR REPLACE FUNCTION public.is_actual_super_admin()
RETURNS BOOLEAN AS $$
DECLARE
  result BOOLEAN;
BEGIN
  SELECT COALESCE(p.is_super_admin, FALSE) OR COALESCE(r.is_super_admin, FALSE)
  INTO result
  FROM profiles p
  LEFT JOIN roles r ON p.role_id = r.id
  WHERE p.id = auth.uid();
  RETURN COALESCE(result, FALSE);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

-- 1c) Return the effective role-id to use for permission checks.
--     If the caller is a real super admin AND provides a valid
--     x-view-as-role-id header, return the override. Otherwise
--     return the caller's actual role.
CREATE OR REPLACE FUNCTION public.effective_role_id()
RETURNS UUID AS $$
DECLARE
  actual_role UUID;
  override_role UUID;
BEGIN
  -- Always fetch the actual role
  SELECT p.role_id INTO actual_role
  FROM profiles p
  WHERE p.id = auth.uid();

  -- Only super admins may override
  IF NOT is_actual_super_admin() THEN
    RETURN actual_role;
  END IF;

  override_role := view_as_role_id();
  IF override_role IS NOT NULL AND EXISTS (SELECT 1 FROM roles WHERE id = override_role) THEN
    RETURN override_role;
  END IF;

  RETURN actual_role;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

-- 1d) Convenience: does the effective role have is_manager_admin = true?
CREATE OR REPLACE FUNCTION public.effective_is_manager_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM roles
    WHERE id = effective_role_id()
      AND is_manager_admin = true
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

-- 1e) Convenience: does the effective role have is_super_admin = true?
CREATE OR REPLACE FUNCTION public.effective_is_super_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM roles
    WHERE id = effective_role_id()
      AND is_super_admin = true
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

-- 1f) Convenience: does the effective role have a given name?
CREATE OR REPLACE FUNCTION public.effective_has_role_name(role_name TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM roles
    WHERE id = effective_role_id()
      AND name = role_name
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

-- 1g) Convenience: does the effective role have a given module permission?
CREATE OR REPLACE FUNCTION public.effective_has_module_permission(module TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  eff_role UUID;
BEGIN
  eff_role := effective_role_id();
  IF eff_role IS NULL THEN RETURN FALSE; END IF;

  -- Manager/admin roles always have all permissions
  IF EXISTS (SELECT 1 FROM roles WHERE id = eff_role AND is_manager_admin = true) THEN
    RETURN TRUE;
  END IF;

  -- Check specific permission
  RETURN EXISTS (
    SELECT 1 FROM role_permissions
    WHERE role_id = eff_role
      AND module_name = module
      AND enabled = true
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

-- ============================================================================
-- PART 2: UPDATE EXISTING RBAC HELPER FUNCTIONS
-- ============================================================================

-- 2a) user_has_permission – use effective role when checking for auth.uid()
--     Must DROP first because we cannot rename parameters with CREATE OR REPLACE.
DROP FUNCTION IF EXISTS public.user_has_permission(UUID, TEXT);

CREATE FUNCTION public.user_has_permission(user_id UUID, module TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  has_access  BOOLEAN;
  is_mgr      BOOLEAN;
BEGIN
  -- If the caller is asking about themselves, use effective role
  IF user_id = auth.uid() THEN
    RETURN effective_has_module_permission(module);
  END IF;

  -- For other users, check their actual role (no override)
  SELECT r.is_manager_admin INTO is_mgr
  FROM profiles p
  INNER JOIN roles r ON p.role_id = r.id
  WHERE p.id = user_id;

  IF is_mgr THEN RETURN TRUE; END IF;

  SELECT rp.enabled INTO has_access
  FROM profiles p
  INNER JOIN roles r ON p.role_id = r.id
  INNER JOIN role_permissions rp ON rp.role_id = r.id
  WHERE p.id = user_id AND rp.module_name = module;

  RETURN COALESCE(has_access, FALSE);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

-- 2b) get_user_permissions – use effective role when checking for auth.uid()
DROP FUNCTION IF EXISTS public.get_user_permissions(UUID);

CREATE FUNCTION public.get_user_permissions(user_id UUID)
RETURNS TABLE (module_name TEXT, enabled BOOLEAN) AS $$
DECLARE
  eff_role UUID;
BEGIN
  IF user_id = auth.uid() THEN
    eff_role := effective_role_id();
  ELSE
    SELECT p.role_id INTO eff_role FROM profiles p WHERE p.id = user_id;
  END IF;

  RETURN QUERY
  SELECT
    rp.module_name,
    CASE
      WHEN r.is_manager_admin THEN TRUE
      ELSE rp.enabled
    END AS enabled
  FROM roles r
  LEFT JOIN role_permissions rp ON rp.role_id = r.id
  WHERE r.id = eff_role;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

-- 2c) has_maintenance_permission – use effective role
CREATE OR REPLACE FUNCTION public.has_maintenance_permission()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN effective_has_module_permission('maintenance');
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

-- ============================================================================
-- PART 3: REWRITE RLS POLICIES (table by table)
-- ============================================================================
-- Each block drops the old policies and recreates them using
-- effective_is_manager_admin() / effective_is_super_admin() /
-- effective_has_role_name() instead of inline role-join patterns.
--
-- Policies that only check auth.uid() = owner (no role check) are untouched.
-- ============================================================================

-- ===== plant =====
DROP POLICY IF EXISTS "plant_read_policy" ON plant;
DROP POLICY IF EXISTS "plant_insert_policy" ON plant;
DROP POLICY IF EXISTS "plant_update_policy" ON plant;
DROP POLICY IF EXISTS "plant_delete_policy" ON plant;

CREATE POLICY "plant_read_policy" ON plant FOR SELECT TO authenticated
USING (
  status IN ('active', 'maintenance')
  OR effective_is_manager_admin()
);
CREATE POLICY "plant_insert_policy" ON plant FOR INSERT TO authenticated
WITH CHECK ( effective_is_manager_admin() );
CREATE POLICY "plant_update_policy" ON plant FOR UPDATE TO authenticated
USING ( effective_is_manager_admin() )
WITH CHECK ( effective_is_manager_admin() );
CREATE POLICY "plant_delete_policy" ON plant FOR DELETE TO authenticated
USING ( effective_is_manager_admin() );

-- ===== inspection_daily_hours =====
DROP POLICY IF EXISTS "Managers can view all inspection daily hours" ON inspection_daily_hours;
DROP POLICY IF EXISTS "Managers can insert all inspection daily hours" ON inspection_daily_hours;
DROP POLICY IF EXISTS "Managers can update all inspection daily hours" ON inspection_daily_hours;
DROP POLICY IF EXISTS "Managers can delete all inspection daily hours" ON inspection_daily_hours;

CREATE POLICY "Managers can view all inspection daily hours" ON inspection_daily_hours
FOR SELECT USING ( effective_is_manager_admin() );
CREATE POLICY "Managers can insert all inspection daily hours" ON inspection_daily_hours
FOR INSERT WITH CHECK ( effective_is_manager_admin() );
CREATE POLICY "Managers can update all inspection daily hours" ON inspection_daily_hours
FOR UPDATE USING ( effective_is_manager_admin() );
CREATE POLICY "Managers can delete all inspection daily hours" ON inspection_daily_hours
FOR DELETE USING ( effective_is_manager_admin() );

-- ===== vehicle_inspections =====
DROP POLICY IF EXISTS "Managers can view all inspections" ON vehicle_inspections;
DROP POLICY IF EXISTS "Managers can create inspections for users" ON vehicle_inspections;
DROP POLICY IF EXISTS "Managers can update inspections" ON vehicle_inspections;
DROP POLICY IF EXISTS "Managers and admins can delete any inspection" ON vehicle_inspections;

CREATE POLICY "Managers can view all inspections" ON vehicle_inspections
FOR SELECT USING ( effective_is_manager_admin() );
CREATE POLICY "Managers can create inspections for users" ON vehicle_inspections
FOR INSERT WITH CHECK ( effective_is_manager_admin() );
CREATE POLICY "Managers can update inspections" ON vehicle_inspections
FOR UPDATE USING ( effective_is_manager_admin() );
CREATE POLICY "Managers and admins can delete any inspection" ON vehicle_inspections
FOR DELETE USING ( effective_is_manager_admin() );

-- ===== inspection_items =====
DROP POLICY IF EXISTS "Managers can view all inspection items" ON inspection_items;
DROP POLICY IF EXISTS "Managers can manage all items" ON inspection_items;

CREATE POLICY "Managers can view all inspection items" ON inspection_items
FOR SELECT USING ( effective_is_manager_admin() );
CREATE POLICY "Managers can manage all items" ON inspection_items
FOR ALL USING ( effective_is_manager_admin() );

-- ===== timesheets =====
DROP POLICY IF EXISTS "Managers can view all timesheets" ON timesheets;
DROP POLICY IF EXISTS "Managers can update timesheets" ON timesheets;

CREATE POLICY "Managers can view all timesheets" ON timesheets
FOR SELECT USING ( effective_is_manager_admin() );
CREATE POLICY "Managers can update timesheets" ON timesheets
FOR UPDATE USING ( effective_is_manager_admin() );

-- ===== timesheet_entries =====
DROP POLICY IF EXISTS "Managers can view all timesheet entries" ON timesheet_entries;
DROP POLICY IF EXISTS "Managers can update all entries" ON timesheet_entries;

CREATE POLICY "Managers can view all timesheet entries" ON timesheet_entries
FOR SELECT USING ( effective_is_manager_admin() );
CREATE POLICY "Managers can update all entries" ON timesheet_entries
FOR UPDATE USING ( effective_is_manager_admin() );

-- ===== absences =====
DROP POLICY IF EXISTS "Managers can view all absences" ON absences;
DROP POLICY IF EXISTS "Managers can update absences" ON absences;

CREATE POLICY "Managers can view all absences" ON absences
FOR SELECT USING ( effective_is_manager_admin() );
CREATE POLICY "Managers can update absences" ON absences
FOR UPDATE USING ( effective_is_manager_admin() );

-- ===== actions =====
DROP POLICY IF EXISTS "Managers can view all actions" ON actions;
DROP POLICY IF EXISTS "Managers can create actions" ON actions;
DROP POLICY IF EXISTS "Managers can update actions" ON actions;
DROP POLICY IF EXISTS "Managers can manage all actions" ON actions;
DROP POLICY IF EXISTS "Managers can delete actions" ON actions;

CREATE POLICY "Managers can view all actions" ON actions
FOR SELECT USING ( effective_is_manager_admin() );
CREATE POLICY "Managers can create actions" ON actions
FOR INSERT WITH CHECK ( effective_is_manager_admin() );
CREATE POLICY "Managers can update actions" ON actions
FOR UPDATE USING ( effective_is_manager_admin() );

-- ===== vehicles =====
DROP POLICY IF EXISTS "Admins can manage vehicles" ON vehicles;
DROP POLICY IF EXISTS "Admins can update vehicles" ON vehicles;
DROP POLICY IF EXISTS "Admins can delete vehicles" ON vehicles;

CREATE POLICY "Admins can manage vehicles" ON vehicles
FOR ALL USING ( effective_is_manager_admin() );

-- ===== profiles =====
DROP POLICY IF EXISTS "Managers can view all profiles" ON profiles;
DROP POLICY IF EXISTS "Admins can update any profile" ON profiles;

CREATE POLICY "Managers can view all profiles" ON profiles
FOR SELECT USING ( effective_is_manager_admin() );
CREATE POLICY "Admins can update any profile" ON profiles
FOR UPDATE USING ( effective_is_super_admin() );

-- ===== messages =====
DROP POLICY IF EXISTS "Managers can view all messages" ON messages;
DROP POLICY IF EXISTS "Managers can create messages" ON messages;
DROP POLICY IF EXISTS "Managers can update messages" ON messages;
DROP POLICY IF EXISTS "Managers can delete messages" ON messages;
DROP POLICY IF EXISTS "Admins can send to anyone" ON messages;

CREATE POLICY "Managers can view all messages" ON messages
FOR SELECT USING ( effective_is_manager_admin() );
CREATE POLICY "Managers can create messages" ON messages
FOR INSERT WITH CHECK ( effective_is_manager_admin() );
CREATE POLICY "Managers can update messages" ON messages
FOR UPDATE USING ( effective_is_manager_admin() );
CREATE POLICY "Managers can delete messages" ON messages
FOR DELETE USING ( effective_is_manager_admin() );

-- ===== message_recipients =====
DROP POLICY IF EXISTS "Managers can view all recipients" ON message_recipients;
DROP POLICY IF EXISTS "Managers can create recipients" ON message_recipients;
DROP POLICY IF EXISTS "Managers can update recipients" ON message_recipients;

CREATE POLICY "Managers can view all recipients" ON message_recipients
FOR SELECT USING ( effective_is_manager_admin() );
CREATE POLICY "Managers can create recipients" ON message_recipients
FOR INSERT WITH CHECK ( effective_is_manager_admin() );
CREATE POLICY "Managers can update recipients" ON message_recipients
FOR UPDATE USING ( effective_is_manager_admin() );

-- ===== rams_documents =====
DROP POLICY IF EXISTS "Managers can view all rams documents" ON rams_documents;
DROP POLICY IF EXISTS "Managers can update rams documents" ON rams_documents;
DROP POLICY IF EXISTS "Managers can delete rams documents" ON rams_documents;

CREATE POLICY "Managers can view all rams documents" ON rams_documents
FOR SELECT USING ( effective_is_manager_admin() );
CREATE POLICY "Managers can update rams documents" ON rams_documents
FOR UPDATE USING ( effective_is_manager_admin() );
CREATE POLICY "Managers can delete rams documents" ON rams_documents
FOR DELETE USING ( effective_is_manager_admin() );

-- ===== rams_assignments =====
DROP POLICY IF EXISTS "Managers can view all assignments" ON rams_assignments;
DROP POLICY IF EXISTS "Managers can create assignments" ON rams_assignments;
DROP POLICY IF EXISTS "Managers can update assignments" ON rams_assignments;

CREATE POLICY "Managers can view all assignments" ON rams_assignments
FOR SELECT USING ( effective_is_manager_admin() );
CREATE POLICY "Managers can create assignments" ON rams_assignments
FOR INSERT WITH CHECK ( effective_is_manager_admin() );
CREATE POLICY "Managers can update assignments" ON rams_assignments
FOR UPDATE USING ( effective_is_manager_admin() );

-- ===== workshop_task_categories =====
DROP POLICY IF EXISTS "Managers can create workshop task categories" ON workshop_task_categories;
DROP POLICY IF EXISTS "Managers can update workshop task categories" ON workshop_task_categories;
DROP POLICY IF EXISTS "Managers can delete workshop task categories" ON workshop_task_categories;

CREATE POLICY "Managers can create workshop task categories" ON workshop_task_categories
FOR INSERT WITH CHECK ( effective_is_manager_admin() );
CREATE POLICY "Managers can update workshop task categories" ON workshop_task_categories
FOR UPDATE USING ( effective_is_manager_admin() );
CREATE POLICY "Managers can delete workshop task categories" ON workshop_task_categories
FOR DELETE USING ( effective_is_manager_admin() );

-- ===== workshop_task_subcategories =====
DROP POLICY IF EXISTS "Managers and admins can create subcategories" ON workshop_task_subcategories;
DROP POLICY IF EXISTS "Managers and admins can update subcategories" ON workshop_task_subcategories;
DROP POLICY IF EXISTS "Managers and admins can delete subcategories" ON workshop_task_subcategories;

CREATE POLICY "Managers and admins can create subcategories" ON workshop_task_subcategories
FOR INSERT WITH CHECK ( effective_is_manager_admin() );
CREATE POLICY "Managers and admins can update subcategories" ON workshop_task_subcategories
FOR UPDATE USING ( effective_is_manager_admin() );
CREATE POLICY "Managers and admins can delete subcategories" ON workshop_task_subcategories
FOR DELETE USING ( effective_is_manager_admin() );

-- ===== workshop_task_comments =====
DROP POLICY IF EXISTS "Authors and managers can update comments" ON workshop_task_comments;
DROP POLICY IF EXISTS "Authors and managers can delete comments" ON workshop_task_comments;

CREATE POLICY "Authors and managers can update comments" ON workshop_task_comments
FOR UPDATE USING (
  author_id = auth.uid() OR effective_is_manager_admin()
);
CREATE POLICY "Authors and managers can delete comments" ON workshop_task_comments
FOR DELETE USING (
  author_id = auth.uid() OR effective_is_manager_admin()
);

-- ===== workshop_attachment_templates =====
DROP POLICY IF EXISTS "Managers and admins can create templates" ON workshop_attachment_templates;
DROP POLICY IF EXISTS "Managers and admins can update templates" ON workshop_attachment_templates;
DROP POLICY IF EXISTS "Managers and admins can delete templates" ON workshop_attachment_templates;

CREATE POLICY "Managers and admins can create templates" ON workshop_attachment_templates
FOR INSERT WITH CHECK ( effective_is_manager_admin() );
CREATE POLICY "Managers and admins can update templates" ON workshop_attachment_templates
FOR UPDATE USING ( effective_is_manager_admin() );
CREATE POLICY "Managers and admins can delete templates" ON workshop_attachment_templates
FOR DELETE USING ( effective_is_manager_admin() );

-- ===== workshop_attachment_questions =====
DROP POLICY IF EXISTS "Managers and admins can create questions" ON workshop_attachment_questions;
DROP POLICY IF EXISTS "Managers and admins can update questions" ON workshop_attachment_questions;
DROP POLICY IF EXISTS "Managers and admins can delete questions" ON workshop_attachment_questions;

CREATE POLICY "Managers and admins can create questions" ON workshop_attachment_questions
FOR INSERT WITH CHECK ( effective_is_manager_admin() );
CREATE POLICY "Managers and admins can update questions" ON workshop_attachment_questions
FOR UPDATE USING ( effective_is_manager_admin() );
CREATE POLICY "Managers and admins can delete questions" ON workshop_attachment_questions
FOR DELETE USING ( effective_is_manager_admin() );

-- ===== workshop_task_attachments =====
DROP POLICY IF EXISTS "Workshop users can create task attachments" ON workshop_task_attachments;
DROP POLICY IF EXISTS "Workshop users can update task attachments" ON workshop_task_attachments;
DROP POLICY IF EXISTS "Managers and admins can delete task attachments" ON workshop_task_attachments;

CREATE POLICY "Workshop users can create task attachments" ON workshop_task_attachments
FOR INSERT WITH CHECK ( effective_has_module_permission('workshop-tasks') );
CREATE POLICY "Workshop users can update task attachments" ON workshop_task_attachments
FOR UPDATE USING ( effective_has_module_permission('workshop-tasks') );
CREATE POLICY "Managers and admins can delete task attachments" ON workshop_task_attachments
FOR DELETE USING ( effective_is_manager_admin() );

-- ===== workshop_attachment_responses =====
DROP POLICY IF EXISTS "Workshop users can create attachment responses" ON workshop_attachment_responses;
DROP POLICY IF EXISTS "Workshop users can update attachment responses" ON workshop_attachment_responses;
DROP POLICY IF EXISTS "Managers and admins can delete attachment responses" ON workshop_attachment_responses;

CREATE POLICY "Workshop users can create attachment responses" ON workshop_attachment_responses
FOR INSERT WITH CHECK ( effective_has_module_permission('workshop-tasks') );
CREATE POLICY "Workshop users can update attachment responses" ON workshop_attachment_responses
FOR UPDATE USING ( effective_has_module_permission('workshop-tasks') );
CREATE POLICY "Managers and admins can delete attachment responses" ON workshop_attachment_responses
FOR DELETE USING ( effective_is_manager_admin() );

-- ===== maintenance_categories =====
DROP POLICY IF EXISTS "Admins manage categories" ON maintenance_categories;

CREATE POLICY "Admins manage categories" ON maintenance_categories
FOR ALL USING (
  effective_has_role_name('admin') OR effective_has_role_name('manager')
  OR effective_is_manager_admin()
);

-- ===== maintenance_category_recipients =====
DROP POLICY IF EXISTS "maintenance_category_recipients_select" ON maintenance_category_recipients;
DROP POLICY IF EXISTS "maintenance_category_recipients_insert" ON maintenance_category_recipients;
DROP POLICY IF EXISTS "maintenance_category_recipients_update" ON maintenance_category_recipients;
DROP POLICY IF EXISTS "maintenance_category_recipients_delete" ON maintenance_category_recipients;

CREATE POLICY "maintenance_category_recipients_select" ON maintenance_category_recipients
FOR SELECT USING ( effective_is_manager_admin() );
CREATE POLICY "maintenance_category_recipients_insert" ON maintenance_category_recipients
FOR INSERT WITH CHECK ( effective_is_manager_admin() );
CREATE POLICY "maintenance_category_recipients_update" ON maintenance_category_recipients
FOR UPDATE USING ( effective_is_manager_admin() );
CREATE POLICY "maintenance_category_recipients_delete" ON maintenance_category_recipients
FOR DELETE USING ( effective_is_manager_admin() );

-- ===== audit_log =====
DROP POLICY IF EXISTS "Managers and admins can view audit logs" ON audit_log;

CREATE POLICY "Managers and admins can view audit logs" ON audit_log
FOR SELECT TO authenticated
USING ( effective_is_manager_admin() );

-- ===== notification_preferences =====
DROP POLICY IF EXISTS "Super admins can view all notification preferences" ON notification_preferences;
DROP POLICY IF EXISTS "Super admins can update all notification preferences" ON notification_preferences;
DROP POLICY IF EXISTS "notification_preferences_insert" ON notification_preferences;
DROP POLICY IF EXISTS "notification_preferences_admin_insert" ON notification_preferences;

CREATE POLICY "Super admins can view all notification preferences" ON notification_preferences
FOR SELECT USING ( effective_is_super_admin() );
CREATE POLICY "Super admins can update all notification preferences" ON notification_preferences
FOR UPDATE USING ( effective_is_super_admin() );
CREATE POLICY "notification_preferences_insert" ON notification_preferences
FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  OR effective_is_super_admin()
  OR effective_is_manager_admin()
);

-- ===== admin_error_notification_prefs =====
DROP POLICY IF EXISTS "Admins can view own error notification preferences" ON admin_error_notification_prefs;
DROP POLICY IF EXISTS "Admins can insert own error notification preferences" ON admin_error_notification_prefs;
DROP POLICY IF EXISTS "Admins can update own error notification preferences" ON admin_error_notification_prefs;
DROP POLICY IF EXISTS "Super admins can view all error notification preferences" ON admin_error_notification_prefs;

CREATE POLICY "Admins can view own error notification preferences" ON admin_error_notification_prefs
FOR SELECT USING (
  user_id = auth.uid() AND (
    effective_has_role_name('admin')
    OR effective_is_super_admin()
    OR effective_is_manager_admin()
  )
);
CREATE POLICY "Admins can insert own error notification preferences" ON admin_error_notification_prefs
FOR INSERT WITH CHECK (
  user_id = auth.uid() AND (
    effective_has_role_name('admin')
    OR effective_is_super_admin()
    OR effective_is_manager_admin()
  )
);
CREATE POLICY "Admins can update own error notification preferences" ON admin_error_notification_prefs
FOR UPDATE USING (
  user_id = auth.uid() AND (
    effective_has_role_name('admin')
    OR effective_is_super_admin()
    OR effective_is_manager_admin()
  )
);
CREATE POLICY "Super admins can view all error notification preferences" ON admin_error_notification_prefs
FOR SELECT USING ( effective_is_super_admin() );

-- ===== error_log_alerts =====
DROP POLICY IF EXISTS "Super admins can view all error log alerts" ON error_log_alerts;
DROP POLICY IF EXISTS "Admins can create error log alerts" ON error_log_alerts;

CREATE POLICY "Super admins can view all error log alerts" ON error_log_alerts
FOR SELECT USING ( effective_is_super_admin() );
CREATE POLICY "Admins can create error log alerts" ON error_log_alerts
FOR INSERT WITH CHECK (
  effective_has_role_name('admin')
  OR effective_is_super_admin()
  OR effective_is_manager_admin()
);

-- ===== error_reports =====
DROP POLICY IF EXISTS "Admins can view all error reports" ON error_reports;
DROP POLICY IF EXISTS "Admins can update error reports" ON error_reports;

CREATE POLICY "Admins can view all error reports" ON error_reports
FOR SELECT USING (
  effective_has_role_name('admin') OR effective_is_super_admin()
);
CREATE POLICY "Admins can update error reports" ON error_reports
FOR UPDATE USING (
  effective_has_role_name('admin') OR effective_is_super_admin()
);

-- ===== error_report_updates =====
DROP POLICY IF EXISTS "Admins can view all error report updates" ON error_report_updates;
DROP POLICY IF EXISTS "Admins can create error report updates" ON error_report_updates;

CREATE POLICY "Admins can view all error report updates" ON error_report_updates
FOR SELECT USING (
  effective_has_role_name('admin') OR effective_is_super_admin()
);
CREATE POLICY "Admins can create error report updates" ON error_report_updates
FOR INSERT WITH CHECK (
  effective_has_role_name('admin') OR effective_is_super_admin()
);

-- ===== roles (RBAC admin tables) =====
DROP POLICY IF EXISTS "Only admins can insert roles" ON roles;
DROP POLICY IF EXISTS "Only admins can update roles" ON roles;
DROP POLICY IF EXISTS "Only admins can delete roles" ON roles;

CREATE POLICY "Only admins can insert roles" ON roles
FOR INSERT TO authenticated WITH CHECK ( effective_is_manager_admin() );
CREATE POLICY "Only admins can update roles" ON roles
FOR UPDATE TO authenticated USING ( effective_is_manager_admin() );
CREATE POLICY "Only admins can delete roles" ON roles
FOR DELETE TO authenticated USING ( effective_is_manager_admin() AND NOT is_super_admin );

-- ===== role_permissions =====
DROP POLICY IF EXISTS "Only admins can insert permissions" ON role_permissions;
DROP POLICY IF EXISTS "Only admins can update permissions" ON role_permissions;
DROP POLICY IF EXISTS "Only admins can delete permissions" ON role_permissions;

CREATE POLICY "Only admins can insert permissions" ON role_permissions
FOR INSERT TO authenticated WITH CHECK ( effective_is_manager_admin() );
CREATE POLICY "Only admins can update permissions" ON role_permissions
FOR UPDATE TO authenticated USING ( effective_is_manager_admin() );
CREATE POLICY "Only admins can delete permissions" ON role_permissions
FOR DELETE TO authenticated USING ( effective_is_manager_admin() );

-- ===== faq_categories =====
DROP POLICY IF EXISTS "Admins can manage FAQ categories" ON faq_categories;

CREATE POLICY "Admins can manage FAQ categories" ON faq_categories
FOR ALL USING ( effective_is_manager_admin() OR effective_is_super_admin() );

-- ===== faq_articles =====
DROP POLICY IF EXISTS "Admins can manage FAQ articles" ON faq_articles;

CREATE POLICY "Admins can manage FAQ articles" ON faq_articles
FOR ALL USING ( effective_is_manager_admin() OR effective_is_super_admin() );

-- ===== suggestions =====
DROP POLICY IF EXISTS "Managers can view all suggestions" ON suggestions;
DROP POLICY IF EXISTS "Managers can update suggestions" ON suggestions;

CREATE POLICY "Managers can view all suggestions" ON suggestions
FOR SELECT USING ( effective_is_manager_admin() OR effective_is_super_admin() );
CREATE POLICY "Managers can update suggestions" ON suggestions
FOR UPDATE USING ( effective_is_manager_admin() OR effective_is_super_admin() );

-- ===== suggestion_updates =====
DROP POLICY IF EXISTS "Managers can view all suggestion updates" ON suggestion_updates;
DROP POLICY IF EXISTS "Managers can create suggestion updates" ON suggestion_updates;

CREATE POLICY "Managers can view all suggestion updates" ON suggestion_updates
FOR SELECT USING ( effective_is_manager_admin() OR effective_is_super_admin() );
CREATE POLICY "Managers can create suggestion updates" ON suggestion_updates
FOR INSERT WITH CHECK ( effective_is_manager_admin() OR effective_is_super_admin() );

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE 'View As effective-role migration applied successfully';
  RAISE NOTICE '  Helper functions created: view_as_role_id, is_actual_super_admin,';
  RAISE NOTICE '    effective_role_id, effective_is_manager_admin, effective_is_super_admin,';
  RAISE NOTICE '    effective_has_role_name, effective_has_module_permission';
  RAISE NOTICE '  Updated RBAC functions: user_has_permission, get_user_permissions,';
  RAISE NOTICE '    has_maintenance_permission';
  RAISE NOTICE '  Rewrote RLS policies for: plant, inspection_daily_hours,';
  RAISE NOTICE '    vehicle_inspections, inspection_items, timesheets,';
  RAISE NOTICE '    timesheet_entries, absences, actions, vehicles, profiles,';
  RAISE NOTICE '    messages, message_recipients, rams_documents, rams_assignments,';
  RAISE NOTICE '    workshop_task_*, maintenance_*, audit_log, notification_preferences,';
  RAISE NOTICE '    error_*, roles, role_permissions, faq_*, suggestions*';
  RAISE NOTICE '';
END $$;

COMMIT;
