-- Permission alignment follow-up from final-diff review.
-- 1) Constrain legacy actions INSERT
-- 2) Lock identity columns on recipient/assignment self-updates
-- 3) Remove remaining broad manager timesheet INSERT/DELETE policies
-- Workstream: ws_permission_alignment_20260806

BEGIN;

-- ---------------------------------------------------------------------------
-- Actions: preserve defect/workshop inserts; require Actions Level 4 otherwise
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can create actions" ON public.actions;
DROP POLICY IF EXISTS "Actions level four can create actions" ON public.actions;
DROP POLICY IF EXISTS "Authenticated users can create constrained defect actions" ON public.actions;

CREATE POLICY "Actions level four can create actions" ON public.actions
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.effective_has_module_level('actions', 4)));

CREATE POLICY "Authenticated users can create constrained defect actions" ON public.actions
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) IS NOT NULL
    AND action_type = ANY (ARRAY['inspection_defect'::text, 'workshop_vehicle_task'::text])
    AND created_by = (SELECT auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Prevent reassignment via self-update policies
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_message_recipient_reassignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.message_id IS DISTINCT FROM OLD.message_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'message_recipients identity columns are immutable'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_message_recipient_reassignment ON public.message_recipients;
CREATE TRIGGER trg_prevent_message_recipient_reassignment
  BEFORE UPDATE ON public.message_recipients
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_message_recipient_reassignment();

CREATE OR REPLACE FUNCTION public.prevent_rams_assignment_reassignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.rams_document_id IS DISTINCT FROM OLD.rams_document_id
     OR NEW.employee_id IS DISTINCT FROM OLD.employee_id THEN
    RAISE EXCEPTION 'rams_assignments identity columns are immutable'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_rams_assignment_reassignment ON public.rams_assignments;
CREATE TRIGGER trg_prevent_rams_assignment_reassignment
  BEFORE UPDATE ON public.rams_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_rams_assignment_reassignment();

-- ---------------------------------------------------------------------------
-- Timesheets: manager create/delete must go through scoped admin APIs
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Managers can create timesheets for any user" ON public.timesheets;
DROP POLICY IF EXISTS "Managers and admins can delete any timesheet" ON public.timesheets;

COMMIT;
