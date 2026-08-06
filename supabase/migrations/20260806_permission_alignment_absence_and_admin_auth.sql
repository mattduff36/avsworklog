-- Permission alignment follow-up: absence approval RLS + admin-tier authorisation.
-- Workstream: ws_permission_alignment_20260806

BEGIN;

-- ---------------------------------------------------------------------------
-- Admin-tier helper (mirrors hasEffectiveRoleFullAccess for effective role)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.effective_has_admin_full_access()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.roles r
    WHERE r.id = public.effective_role_id()
      AND (
        r.is_super_admin IS TRUE
        OR r.role_class = 'admin'
        OR LOWER(TRIM(r.name)) = 'admin'
      )
  );
$$;

COMMENT ON FUNCTION public.effective_has_admin_full_access()
  IS 'Effective-role admin/super-admin full access; mirrors TypeScript hasEffectiveRoleFullAccess.';

-- ---------------------------------------------------------------------------
-- Timesheet authorisation: admin tier keeps global access (still no self)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_actor_authorise_timesheet(target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR target_user_id IS NULL OR auth.uid() = target_user_id THEN
    RETURN FALSE;
  END IF;

  IF public.permission_alignment_effective_module_access_level('approvals') < 3 THEN
    RETURN FALSE;
  END IF;

  IF public.effective_has_admin_full_access() THEN
    RETURN TRUE;
  END IF;

  IF public.effective_accounts_timesheet_full_visibility_override() THEN
    RETURN TRUE;
  END IF;

  IF public.permission_alignment_absence_secondary_effective_cell('authorise_bookings_all') IS TRUE THEN
    RETURN TRUE;
  END IF;

  RETURN (
    public.permission_alignment_absence_secondary_effective_cell('authorise_bookings_team') IS TRUE
    AND public.are_effective_actor_and_target_in_same_team(target_user_id)
  );
END;
$$;

COMMENT ON FUNCTION public.can_actor_authorise_timesheet(UUID)
  IS 'Approvals Level 3+ plus admin/Accounts/ALL/TEAM authorisation scope; always denies self.';

-- ---------------------------------------------------------------------------
-- Absence authorisation: align with timesheet helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_actor_approve_absence_request(
  actor_profile_id UUID,
  requester_profile_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF actor_profile_id IS NULL OR requester_profile_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF actor_profile_id = requester_profile_id THEN
    RETURN FALSE;
  END IF;

  -- Prefer the JWT actor path used by RLS (view-as aware helpers).
  IF actor_profile_id = auth.uid() THEN
    IF public.permission_alignment_effective_module_access_level('approvals') < 3 THEN
      RETURN FALSE;
    END IF;

    IF public.effective_has_admin_full_access() THEN
      RETURN TRUE;
    END IF;

    IF public.effective_accounts_timesheet_full_visibility_override() THEN
      RETURN TRUE;
    END IF;

    IF public.permission_alignment_absence_secondary_effective_cell('authorise_bookings_all') IS TRUE THEN
      RETURN TRUE;
    END IF;

    RETURN (
      public.permission_alignment_absence_secondary_effective_cell('authorise_bookings_team') IS TRUE
      AND public.are_effective_actor_and_target_in_same_team(requester_profile_id)
    );
  END IF;

  -- Legacy non-JWT call sites keep the previous secondary-permission path.
  RETURN public.can_actor_secondary_absence_permission(
    actor_profile_id,
    requester_profile_id,
    'authorise_bookings'
  );
END;
$$;

COMMENT ON FUNCTION public.can_actor_approve_absence_request(UUID, UUID)
  IS 'Approvals Level 3+ plus admin/Accounts/ALL/TEAM scope for JWT actors; always denies self.';

-- ---------------------------------------------------------------------------
-- Drop legacy global manage policy (profiles.role text bypass)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can manage all absences" ON public.absences;

-- Own updates may cancel or edit pending rows, but cannot self-approve/reject.
DROP POLICY IF EXISTS "Users can update own pending future absences" ON public.absences;
CREATE POLICY "Users can update own pending future absences"
  ON public.absences
  FOR UPDATE
  TO authenticated
  USING (
    (SELECT auth.uid()) = profile_id
    AND status = 'pending'
    AND date >= CURRENT_DATE
  )
  WITH CHECK (
    (SELECT auth.uid()) = profile_id
    AND status = ANY (ARRAY['pending'::text, 'cancelled'::text])
    AND date >= CURRENT_DATE
  );

-- Harden status transitions even if an editor UPDATE policy would otherwise allow them.
CREATE OR REPLACE FUNCTION public.enforce_absence_status_transition_auth()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- Employees may cancel their own pending absences.
  IF NEW.profile_id = auth.uid()
     AND OLD.status = 'pending'
     AND NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'pending' AND NEW.status = ANY (ARRAY['approved'::text, 'rejected'::text]) THEN
    IF NOT public.can_actor_approve_absence_request(auth.uid(), NEW.profile_id) THEN
      RAISE EXCEPTION 'Not authorised to approve or reject this absence'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT public.can_actor_edit_absence_request(auth.uid(), NEW.profile_id) THEN
    RAISE EXCEPTION 'Not authorised to change absence status'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_absence_status_transition_auth ON public.absences;
CREATE TRIGGER trg_enforce_absence_status_transition_auth
  BEFORE UPDATE ON public.absences
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_absence_status_transition_auth();

COMMIT;
