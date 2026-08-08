-- Additive closure fixes for unified asset service scheduling review.
-- Safe to re-run.

-- TEST-HGV is a fixture and must not inherit live Engine Service state.
UPDATE public.vehicle_maintenance vm
SET
  next_service_mileage = NULL,
  last_service_mileage = NULL,
  last_service_template_id = NULL,
  next_service_template_id = NULL,
  next_service_rotation_step_id = NULL,
  updated_at = NOW()
FROM public.hgvs h
WHERE h.id = vm.hgv_id
  AND (
    UPPER(regexp_replace(h.reg_number, '[^A-Z0-9]', '', 'g')) = 'TE57HGV'
    OR LOWER(COALESCE(h.nickname, '')) = 'test-hgv'
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.vehicle_maintenance vm
    JOIN public.hgvs h ON h.id = vm.hgv_id
    WHERE (
      UPPER(regexp_replace(h.reg_number, '[^A-Z0-9]', '', 'g')) = 'TE57HGV'
      OR LOWER(COALESCE(h.nickname, '')) = 'test-hgv'
    )
      AND (
        vm.next_service_mileage IS NOT NULL
        OR vm.last_service_mileage IS NOT NULL
        OR vm.last_service_template_id IS NOT NULL
        OR vm.next_service_template_id IS NOT NULL
        OR vm.next_service_rotation_step_id IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'TEST-HGV retained unified service state';
  END IF;
END;
$$;

-- Service cursor fields are manager/admin-only for authenticated clients.
CREATE OR REPLACE FUNCTION public.protect_vehicle_maintenance_service_state()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    NEW.next_service_template_id IS DISTINCT FROM OLD.next_service_template_id
    OR NEW.next_service_rotation_step_id IS DISTINCT FROM OLD.next_service_rotation_step_id
    OR NEW.last_service_template_id IS DISTINCT FROM OLD.last_service_template_id
  )
    AND current_user NOT IN ('postgres', 'service_role', 'supabase_admin')
    AND COALESCE(auth.role(), '') <> 'service_role'
    AND NOT public.effective_is_manager_admin()
  THEN
    RAISE EXCEPTION 'Manager or admin required to update service rotation state'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_vehicle_maintenance_service_state
  ON public.vehicle_maintenance;
CREATE TRIGGER trg_protect_vehicle_maintenance_service_state
  BEFORE UPDATE OF next_service_template_id, next_service_rotation_step_id, last_service_template_id
  ON public.vehicle_maintenance
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_vehicle_maintenance_service_state();

-- Keep event reads unchanged; authenticated inserts require manager/admin.
DROP POLICY IF EXISTS "Managers insert service events"
  ON public.asset_service_events;
CREATE POLICY "Managers insert service events"
  ON public.asset_service_events
  FOR INSERT
  TO authenticated
  WITH CHECK (public.effective_is_manager_admin());

-- Immutable service events survive attempts to delete their asset.
ALTER TABLE public.asset_service_events
  DROP CONSTRAINT IF EXISTS asset_service_events_van_id_fkey,
  DROP CONSTRAINT IF EXISTS asset_service_events_hgv_id_fkey,
  DROP CONSTRAINT IF EXISTS asset_service_events_plant_id_fkey;

ALTER TABLE public.asset_service_events
  ADD CONSTRAINT asset_service_events_van_id_fkey
    FOREIGN KEY (van_id) REFERENCES public.vans(id) ON DELETE RESTRICT,
  ADD CONSTRAINT asset_service_events_hgv_id_fkey
    FOREIGN KEY (hgv_id) REFERENCES public.hgvs(id) ON DELETE RESTRICT,
  ADD CONSTRAINT asset_service_events_plant_id_fkey
    FOREIGN KEY (plant_id) REFERENCES public.plant(id) ON DELETE RESTRICT;

-- A completed Service task is corrected by an append-only correction event,
-- never by reverting the action to an incomplete state.
CREATE OR REPLACE FUNCTION public.prevent_completed_service_task_undo()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'completed'
    AND (
      NEW.status IS DISTINCT FROM OLD.status
      OR NEW.actioned IS DISTINCT FROM OLD.actioned
    )
    AND (NEW.status <> 'completed' OR NEW.actioned IS NOT TRUE)
    AND EXISTS (
      SELECT 1
      FROM public.asset_service_events e
      WHERE e.task_id = OLD.id
        AND e.event_type = 'completion'
    )
  THEN
    RAISE EXCEPTION 'Completed Service tasks cannot be undone; use an audited correction'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_completed_service_task_undo
  ON public.actions;
CREATE TRIGGER trg_prevent_completed_service_task_undo
  BEFORE UPDATE OF status, actioned
  ON public.actions
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_completed_service_task_undo();
