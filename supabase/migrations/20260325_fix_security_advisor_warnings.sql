-- =============================================================================
-- Fix Supabase Security Advisor warnings (2026-03-25)
-- =============================================================================
-- 1. Re-create missing RLS policies on absence_bulk_batches
-- 2. Harden all SECURITY DEFINER functions with SET search_path = public
-- =============================================================================

-- ── 1. absence_bulk_batches RLS policies ────────────────────────────────────

DROP POLICY IF EXISTS "Managers can view bulk absence batches" ON absence_bulk_batches;
CREATE POLICY "Managers can view bulk absence batches" ON absence_bulk_batches
FOR SELECT TO authenticated
USING (effective_is_manager_admin());

DROP POLICY IF EXISTS "Managers can create bulk absence batches" ON absence_bulk_batches;
CREATE POLICY "Managers can create bulk absence batches" ON absence_bulk_batches
FOR INSERT TO authenticated
WITH CHECK (effective_is_manager_admin());

DROP POLICY IF EXISTS "Managers can update bulk absence batches" ON absence_bulk_batches;
CREATE POLICY "Managers can update bulk absence batches" ON absence_bulk_batches
FOR UPDATE TO authenticated
USING (effective_is_manager_admin())
WITH CHECK (effective_is_manager_admin());

DROP POLICY IF EXISTS "Managers can delete bulk absence batches" ON absence_bulk_batches;
CREATE POLICY "Managers can delete bulk absence batches" ON absence_bulk_batches
FOR DELETE TO authenticated
USING (effective_is_manager_admin());

-- ── 2. Fix search_path on all SECURITY DEFINER functions ────────────────────
-- Without a fixed search_path, a malicious schema can shadow public objects.

ALTER FUNCTION archive_closed_financial_year_absences(integer, uuid, text, text, boolean) SET search_path = public;
ALTER FUNCTION can_actor_access_absence_request(uuid, uuid) SET search_path = public;
ALTER FUNCTION can_actor_approve_absence_request(uuid, uuid) SET search_path = public;
ALTER FUNCTION create_default_employee_work_shift() SET search_path = public;
ALTER FUNCTION effective_can_assign_role(uuid) SET search_path = public;
ALTER FUNCTION effective_has_module_permission(text) SET search_path = public;
ALTER FUNCTION effective_has_role_name(text) SET search_path = public;
ALTER FUNCTION effective_is_admin() SET search_path = public;
ALTER FUNCTION effective_is_manager() SET search_path = public;
ALTER FUNCTION effective_is_manager_admin() SET search_path = public;
ALTER FUNCTION effective_is_super_admin() SET search_path = public;
ALTER FUNCTION effective_role_class() SET search_path = public;
ALTER FUNCTION effective_role_id() SET search_path = public;
ALTER FUNCTION effective_team_id() SET search_path = public;
ALTER FUNCTION effective_team_mode(uuid, text) SET search_path = public;
ALTER FUNCTION get_latest_mot_test(uuid) SET search_path = public;
ALTER FUNCTION get_latest_passed_mot(uuid) SET search_path = public;
ALTER FUNCTION get_user_permissions(uuid) SET search_path = public;
ALTER FUNCTION handle_new_user() SET search_path = public;
ALTER FUNCTION has_maintenance_permission() SET search_path = public;
ALTER FUNCTION is_actor_admin(uuid) SET search_path = public;
ALTER FUNCTION is_actor_line_manager_of(uuid, uuid) SET search_path = public;
ALTER FUNCTION is_actor_manager_admin(uuid) SET search_path = public;
ALTER FUNCTION is_actual_super_admin() SET search_path = public;
ALTER FUNCTION log_audit_changes() SET search_path = public;
ALTER FUNCTION role_on_team_has_module_permission(uuid, text, text) SET search_path = public;
ALTER FUNCTION sync_vehicle_type_from_category() SET search_path = public;
ALTER FUNCTION update_hgv_maintenance_mileage() SET search_path = public;
ALTER FUNCTION update_plant_maintenance_hours() SET search_path = public;
ALTER FUNCTION update_van_maintenance_mileage() SET search_path = public;
ALTER FUNCTION user_has_permission(uuid, text) SET search_path = public;
ALTER FUNCTION view_as_role_id() SET search_path = public;
ALTER FUNCTION view_as_team_id() SET search_path = public;
