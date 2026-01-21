-- Migration: Fix Supabase Database Linter Security Findings
-- Date: 2026-01-21
-- Purpose: Address ERROR and WARN level security findings from Supabase linter
-- Related: Supabase linter email report (policy_exists_rls_disabled, rls_references_user_metadata, etc.)
--
-- This migration addresses:
-- 1. RLS not enabled on public.roles (ERROR)
-- 2. Insecure user_metadata references in RLS policies (ERROR)
-- 3. Overly permissive INSERT policies with WITH CHECK (true) (WARN)
-- 4. Function search_path not set (WARN) - potential security issue for SECURITY DEFINER functions

BEGIN;

-- ============================================================================
-- PART 1: ENABLE RLS ON public.roles
-- ============================================================================
-- Supabase flagged: "Table `public.roles` has RLS policies but RLS is not enabled on the table"

-- Ensure RLS is enabled (idempotent - safe to run multiple times)
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

-- Verify policies exist (they should already be created from create-roles-and-permissions.sql)
-- If not, they'll be listed here for reference but should already exist:
-- - "Anyone can view roles" (SELECT)
-- - "Only admins can insert roles" (INSERT)
-- - "Only admins can update roles" (UPDATE)
-- - "Only admins can delete roles" (DELETE)

COMMENT ON TABLE public.roles IS 'Role definitions for RBAC system (RLS enabled)';

-- ============================================================================
-- PART 2: FIX INSECURE user_metadata REFERENCES IN RLS POLICIES
-- ============================================================================
-- Supabase flagged: "Table `public.audit_log` has a row level security policy 
-- `Admins can view all audit logs` that references Supabase Auth `user_metadata`. 
-- `user_metadata` is editable by end users and should never be used in a security context."

-- Drop old insecure policies that check user_metadata
DROP POLICY IF EXISTS "Admins can view all audit logs" ON public.audit_log;
DROP POLICY IF EXISTS "SuperAdmins can view all audit logs" ON public.audit_log;
DROP POLICY IF EXISTS "Admins and Managers can view audit logs" ON public.audit_log;

-- Create new secure policy using DB RBAC tables
CREATE POLICY "Managers and admins can view audit logs"
  ON public.audit_log
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
        AND r.is_manager_admin = true
    )
  );

COMMENT ON TABLE public.audit_log IS 'Audit trail of changes (only managers/admins can read, RLS uses DB RBAC not user_metadata)';

-- ============================================================================
-- PART 3: TIGHTEN OVERLY PERMISSIVE INSERT POLICIES
-- ============================================================================
-- Supabase flagged: "RLS Policy Always True" - WITH CHECK (true) for INSERT operations
-- effectively bypasses row-level security

-- ===== Fix audit_log INSERT policy =====
-- Old policy: "System can insert audit logs" FOR INSERT WITH CHECK (true)
-- New policy: Users can only insert logs for themselves (prevents fake audit entries)

DROP POLICY IF EXISTS "System can insert audit logs" ON public.audit_log;

CREATE POLICY "Users can insert own audit logs"
  ON public.audit_log
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Only allow inserting if user_id matches auth.uid() OR user_id is NULL (system-triggered)
    user_id = auth.uid() OR user_id IS NULL
  );

-- ===== Fix error_logs INSERT policy =====
-- Old policy: "Users can insert error logs" FOR INSERT WITH CHECK (true)
-- New policy: Users can only insert error logs for themselves

DROP POLICY IF EXISTS "Users can insert error logs" ON public.error_logs;

CREATE POLICY "Users can insert own error logs"
  ON public.error_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Only allow inserting if user_id matches auth.uid() OR user_id is NULL (anonymous errors)
    user_id = auth.uid() OR user_id IS NULL
  );

COMMENT ON TABLE public.error_logs IS 'Application error tracking (users can only insert for themselves)';

-- ============================================================================
-- PART 4: FIX FUNCTION SEARCH_PATH MUTABLE WARNINGS
-- ============================================================================
-- Supabase flagged 18 functions with mutable search_path
-- Setting a fixed search_path prevents search_path hijacking attacks
-- Especially critical for SECURITY DEFINER functions

-- Format: ALTER FUNCTION function_name() SET search_path = public, pg_temp;

-- Trigger functions (simple, no parameters)
ALTER FUNCTION public.sync_vehicle_type_from_category() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_workshop_task_comments_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_rams_document_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_messages_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_message_recipients_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_updated_at_column() SET search_path = public, pg_temp;
ALTER FUNCTION public.sync_workshop_category_from_subcategory() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_workshop_task_subcategories_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_vehicle_maintenance_mileage() SET search_path = public, pg_temp;
ALTER FUNCTION public.handle_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.log_audit_changes() SET search_path = public, pg_temp;
ALTER FUNCTION public.handle_new_user() SET search_path = public, pg_temp;

-- Permission check functions (SECURITY DEFINER - critical to harden)
ALTER FUNCTION public.user_has_permission(uuid, text) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_user_permissions(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.has_maintenance_permission() SET search_path = public, pg_temp;

-- Query functions (STABLE)
ALTER FUNCTION public.count_mot_defects_by_type(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_latest_mot_test(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_latest_passed_mot(uuid) SET search_path = public, pg_temp;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Supabase Linter Security Fixes Applied Successfully';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE 'Fixed items:';
  RAISE NOTICE '  ✓ Enabled RLS on public.roles';
  RAISE NOTICE '  ✓ Replaced user_metadata checks with DB RBAC (audit_log policies)';
  RAISE NOTICE '  ✓ Tightened INSERT policies (audit_log, error_logs)';
  RAISE NOTICE '  ✓ Set fixed search_path for 18 functions';
  RAISE NOTICE '';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '  1. Test application functionality (especially audit logs and error reporting)';
  RAISE NOTICE '  2. Monitor Supabase linter dashboard for confirmation';
  RAISE NOTICE '  3. (Optional) Enable leaked password protection in Auth settings';
  RAISE NOTICE '  4. (Optional) Add additional MFA options in Auth settings';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '';
END $$;

COMMIT;

-- ============================================================================
-- ROLLBACK INSTRUCTIONS (if needed)
-- ============================================================================
-- If you need to undo this migration:
--
-- BEGIN;
-- -- Revert RLS (not recommended - would expose data)
-- -- ALTER TABLE public.roles DISABLE ROW LEVEL SECURITY;
-- 
-- -- Restore old policies (not recommended - they're insecure)
-- -- (see supabase/enable-audit-logging.sql for original definitions)
--
-- -- Remove search_path settings
-- -- ALTER FUNCTION public.function_name() RESET search_path;
-- COMMIT;
--
-- Note: Rolling back these security fixes would reintroduce vulnerabilities.
-- Only do this if absolutely necessary and you understand the risks.
