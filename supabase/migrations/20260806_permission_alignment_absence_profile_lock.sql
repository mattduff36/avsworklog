-- Lock absences.profile_id on authenticated updates to prevent ownership-pivot
-- self-approval / self-processing. Workstream: ws_permission_alignment_20260806

BEGIN;

CREATE OR REPLACE FUNCTION public.prevent_absence_profile_reassignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Service-role / non-JWT writers may still move rows during admin repairs.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.profile_id IS DISTINCT FROM OLD.profile_id THEN
    RAISE EXCEPTION 'absences.profile_id is immutable for authenticated updates'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_absence_profile_reassignment ON public.absences;
CREATE TRIGGER trg_prevent_absence_profile_reassignment
  BEFORE UPDATE ON public.absences
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_absence_profile_reassignment();

-- Also evaluate approval transitions against the immutable owner.
CREATE OR REPLACE FUNCTION public.enforce_absence_status_transition_auth()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_id UUID := auth.uid();
  owner_id UUID := OLD.profile_id;
BEGIN
  IF actor_id IS NULL OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'cancelled'
     AND OLD.status = ANY (ARRAY['pending'::text, 'approved'::text, 'processed'::text]) THEN
    IF owner_id = actor_id AND OLD.status = 'pending' THEN
      RETURN NEW;
    END IF;

    IF public.can_actor_edit_absence_request(actor_id, owner_id) THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Not authorised to cancel this absence'
      USING ERRCODE = '42501';
  END IF;

  IF (
        OLD.status = 'pending'
        AND NEW.status = ANY (ARRAY['approved'::text, 'rejected'::text])
      )
      OR (
        OLD.status = 'approved'
        AND NEW.status = 'processed'
      ) THEN
    IF NOT public.can_actor_approve_absence_request(actor_id, owner_id) THEN
      RAISE EXCEPTION 'Not authorised to approve, reject, or process this absence'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Unsupported absence status transition from % to %', OLD.status, NEW.status
    USING ERRCODE = '42501';
END;
$$;

COMMIT;
