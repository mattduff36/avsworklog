BEGIN;

-- ============================================================================
-- Supabase Advisor remediation: explicit policies for RLS-enabled tables
-- ============================================================================
-- These tables already had RLS enabled, but no explicit policies were present.
-- The goal here is to make intent explicit:
--   1. app_auth_sessions stays server-owned and inaccessible to direct clients
--   2. work-shift data gets least-privilege policies for self-read and
--      manager/admin management paths
-- ============================================================================

-- ---- app_auth_sessions ------------------------------------------------------
-- Server-owned session state is read and mutated through admin/service flows.
-- Add an explicit deny policy for authenticated callers so the table no longer
-- registers as "RLS enabled with no policy" while remaining inaccessible.
DROP POLICY IF EXISTS "Authenticated users cannot access app auth sessions directly"
  ON public.app_auth_sessions;

CREATE POLICY "Authenticated users cannot access app auth sessions directly"
  ON public.app_auth_sessions
  FOR ALL
  TO authenticated
  USING (FALSE)
  WITH CHECK (FALSE);

-- ---- work_shift_templates ---------------------------------------------------
DROP POLICY IF EXISTS "Absence users can view work shift templates"
  ON public.work_shift_templates;
DROP POLICY IF EXISTS "Managers can create work shift templates"
  ON public.work_shift_templates;
DROP POLICY IF EXISTS "Managers can update work shift templates"
  ON public.work_shift_templates;
DROP POLICY IF EXISTS "Managers can delete work shift templates"
  ON public.work_shift_templates;

CREATE POLICY "Absence users can view work shift templates"
  ON public.work_shift_templates
  FOR SELECT
  TO authenticated
  USING ((SELECT effective_has_module_permission('absence')));

CREATE POLICY "Managers can create work shift templates"
  ON public.work_shift_templates
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT effective_is_manager_admin()));

CREATE POLICY "Managers can update work shift templates"
  ON public.work_shift_templates
  FOR UPDATE
  TO authenticated
  USING ((SELECT effective_is_manager_admin()))
  WITH CHECK ((SELECT effective_is_manager_admin()));

CREATE POLICY "Managers can delete work shift templates"
  ON public.work_shift_templates
  FOR DELETE
  TO authenticated
  USING ((SELECT effective_is_manager_admin()));

-- ---- work_shift_template_slots ----------------------------------------------
DROP POLICY IF EXISTS "Absence users can view work shift template slots"
  ON public.work_shift_template_slots;
DROP POLICY IF EXISTS "Managers can create work shift template slots"
  ON public.work_shift_template_slots;
DROP POLICY IF EXISTS "Managers can update work shift template slots"
  ON public.work_shift_template_slots;
DROP POLICY IF EXISTS "Managers can delete work shift template slots"
  ON public.work_shift_template_slots;

CREATE POLICY "Absence users can view work shift template slots"
  ON public.work_shift_template_slots
  FOR SELECT
  TO authenticated
  USING ((SELECT effective_has_module_permission('absence')));

CREATE POLICY "Managers can create work shift template slots"
  ON public.work_shift_template_slots
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT effective_is_manager_admin()));

CREATE POLICY "Managers can update work shift template slots"
  ON public.work_shift_template_slots
  FOR UPDATE
  TO authenticated
  USING ((SELECT effective_is_manager_admin()))
  WITH CHECK ((SELECT effective_is_manager_admin()));

CREATE POLICY "Managers can delete work shift template slots"
  ON public.work_shift_template_slots
  FOR DELETE
  TO authenticated
  USING ((SELECT effective_is_manager_admin()));

-- ---- employee_work_shifts ---------------------------------------------------
DROP POLICY IF EXISTS "Users can view own work shift"
  ON public.employee_work_shifts;
DROP POLICY IF EXISTS "Managers can view all employee work shifts"
  ON public.employee_work_shifts;
DROP POLICY IF EXISTS "Users can create own work shift"
  ON public.employee_work_shifts;
DROP POLICY IF EXISTS "Managers can create employee work shifts"
  ON public.employee_work_shifts;
DROP POLICY IF EXISTS "Managers can update employee work shifts"
  ON public.employee_work_shifts;
DROP POLICY IF EXISTS "Managers can delete employee work shifts"
  ON public.employee_work_shifts;

CREATE POLICY "Users can view own work shift"
  ON public.employee_work_shifts
  FOR SELECT
  TO authenticated
  USING (profile_id = (SELECT auth.uid()));

CREATE POLICY "Managers can view all employee work shifts"
  ON public.employee_work_shifts
  FOR SELECT
  TO authenticated
  USING ((SELECT effective_is_manager_admin()));

CREATE POLICY "Users can create own work shift"
  ON public.employee_work_shifts
  FOR INSERT
  TO authenticated
  WITH CHECK (profile_id = (SELECT auth.uid()));

CREATE POLICY "Managers can create employee work shifts"
  ON public.employee_work_shifts
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT effective_is_manager_admin()));

CREATE POLICY "Managers can update employee work shifts"
  ON public.employee_work_shifts
  FOR UPDATE
  TO authenticated
  USING ((SELECT effective_is_manager_admin()))
  WITH CHECK ((SELECT effective_is_manager_admin()));

CREATE POLICY "Managers can delete employee work shifts"
  ON public.employee_work_shifts
  FOR DELETE
  TO authenticated
  USING ((SELECT effective_is_manager_admin()));

-- ---- verification -----------------------------------------------------------
DO $$
DECLARE
  target RECORD;
  policy_count INTEGER;
BEGIN
  FOR target IN
    SELECT unnest(ARRAY[
      'app_auth_sessions',
      'work_shift_templates',
      'work_shift_template_slots',
      'employee_work_shifts'
    ]) AS table_name
  LOOP
    SELECT COUNT(*)
    INTO policy_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = target.table_name;

    IF policy_count = 0 THEN
      RAISE EXCEPTION 'Expected policies to exist for %, but found none', target.table_name;
    END IF;
  END LOOP;
END $$;

COMMIT;
