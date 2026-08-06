-- Tighten absence status transition matrix after final review.
-- Workstream: ws_permission_alignment_20260806

BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_absence_status_transition_auth()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_id UUID := auth.uid();
BEGIN
  -- Service-role / non-JWT writers bypass this guard.
  IF actor_id IS NULL OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- Cancel paths:
  -- - own pending cancel
  -- - scoped editors may cancel pending/approved/processed bookings
  IF NEW.status = 'cancelled'
     AND OLD.status = ANY (ARRAY['pending'::text, 'approved'::text, 'processed'::text]) THEN
    IF NEW.profile_id = actor_id AND OLD.status = 'pending' THEN
      RETURN NEW;
    END IF;

    IF public.can_actor_edit_absence_request(actor_id, NEW.profile_id) THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Not authorised to cancel this absence'
      USING ERRCODE = '42501';
  END IF;

  -- Authorisation workflow transitions require Approvals scope (no self).
  IF (
        OLD.status = 'pending'
        AND NEW.status = ANY (ARRAY['approved'::text, 'rejected'::text])
      )
      OR (
        OLD.status = 'approved'
        AND NEW.status = 'processed'
      ) THEN
    IF NOT public.can_actor_approve_absence_request(actor_id, NEW.profile_id) THEN
      RAISE EXCEPTION 'Not authorised to approve, reject, or process this absence'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Unsupported absence status transition from % to %', OLD.status, NEW.status
    USING ERRCODE = '42501';
END;
$$;

COMMENT ON FUNCTION public.enforce_absence_status_transition_auth()
  IS 'Enforces absence status transition matrix: approve/reject/process require Approvals scope; cancel uses own/edit rules; all other transitions fail closed.';

COMMIT;
