-- Closure fixes for remaining review blockers (safe to re-run).

-- SVC-MIG-003: only Van Repair subcategories stay deactivated.
-- Reactivate every other subcategory that the unify migration flattened.
UPDATE public.workshop_task_subcategories s
SET is_active = TRUE,
    updated_at = NOW()
FROM public.workshop_task_categories c
WHERE c.id = s.category_id
  AND c.name NOT ILIKE 'Repair (Van)';

-- Restore manager subcategory mutation policies (reads already exist).
DROP POLICY IF EXISTS "Managers and admins can create subcategories"
  ON public.workshop_task_subcategories;
CREATE POLICY "Managers and admins can create subcategories"
  ON public.workshop_task_subcategories
  FOR INSERT
  TO authenticated
  WITH CHECK (public.effective_is_manager_admin());

DROP POLICY IF EXISTS "Managers and admins can update subcategories"
  ON public.workshop_task_subcategories;
CREATE POLICY "Managers and admins can update subcategories"
  ON public.workshop_task_subcategories
  FOR UPDATE
  TO authenticated
  USING (public.effective_is_manager_admin())
  WITH CHECK (public.effective_is_manager_admin());

DROP POLICY IF EXISTS "Managers and admins can delete subcategories"
  ON public.workshop_task_subcategories;
CREATE POLICY "Managers and admins can delete subcategories"
  ON public.workshop_task_subcategories
  FOR DELETE
  TO authenticated
  USING (public.effective_is_manager_admin());

DO $$
DECLARE
  active_repair INTEGER;
  inactive_non_repair INTEGER;
BEGIN
  SELECT COUNT(*) INTO active_repair
  FROM public.workshop_task_subcategories s
  JOIN public.workshop_task_categories c ON c.id = s.category_id
  WHERE s.is_active = TRUE
    AND c.name ILIKE 'Repair (Van)';

  SELECT COUNT(*) INTO inactive_non_repair
  FROM public.workshop_task_subcategories s
  JOIN public.workshop_task_categories c ON c.id = s.category_id
  WHERE s.is_active = FALSE
    AND c.name NOT ILIKE 'Repair (Van)';

  IF active_repair <> 0 THEN
    RAISE EXCEPTION 'Van Repair subcategories must remain deactivated (found % active)', active_repair;
  END IF;
  IF inactive_non_repair <> 0 THEN
    RAISE EXCEPTION 'Non-repair subcategories must be reactivated (found % inactive)', inactive_non_repair;
  END IF;
END;
$$;

-- SVC-RLS-001: protect service due/last meter fields as well as template cursors.
CREATE OR REPLACE FUNCTION public.protect_vehicle_maintenance_service_state()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  acting_role TEXT := current_user;
  jwt_role TEXT := '';
  is_manager BOOLEAN := FALSE;
BEGIN
  BEGIN
    jwt_role := COALESCE(auth.role(), '');
  EXCEPTION WHEN OTHERS THEN
    jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
  END;

  BEGIN
    is_manager := public.effective_is_manager_admin();
  EXCEPTION WHEN OTHERS THEN
    is_manager := FALSE;
  END;

  IF TG_OP = 'INSERT' THEN
    IF (
      NEW.next_service_template_id IS NOT NULL
      OR NEW.next_service_rotation_step_id IS NOT NULL
      OR NEW.last_service_template_id IS NOT NULL
      OR NEW.next_service_mileage IS NOT NULL
      OR NEW.last_service_mileage IS NOT NULL
      OR NEW.next_service_hours IS NOT NULL
      OR NEW.last_service_hours IS NOT NULL
    )
      AND acting_role NOT IN ('postgres', 'service_role', 'supabase_admin')
      AND jwt_role <> 'service_role'
      AND NOT is_manager
    THEN
      RAISE EXCEPTION 'Manager or admin required to set service state on insert'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF (
    NEW.next_service_template_id IS DISTINCT FROM OLD.next_service_template_id
    OR NEW.next_service_rotation_step_id IS DISTINCT FROM OLD.next_service_rotation_step_id
    OR NEW.last_service_template_id IS DISTINCT FROM OLD.last_service_template_id
    OR NEW.next_service_mileage IS DISTINCT FROM OLD.next_service_mileage
    OR NEW.last_service_mileage IS DISTINCT FROM OLD.last_service_mileage
    OR NEW.next_service_hours IS DISTINCT FROM OLD.next_service_hours
    OR NEW.last_service_hours IS DISTINCT FROM OLD.last_service_hours
  )
    AND acting_role NOT IN ('postgres', 'service_role', 'supabase_admin')
    AND jwt_role <> 'service_role'
    AND NOT is_manager
  THEN
    RAISE EXCEPTION 'Manager or admin required to update service state'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_vehicle_maintenance_service_state
  ON public.vehicle_maintenance;
CREATE TRIGGER trg_protect_vehicle_maintenance_service_state
  BEFORE INSERT OR UPDATE OF
    next_service_template_id,
    next_service_rotation_step_id,
    last_service_template_id,
    next_service_mileage,
    last_service_mileage,
    next_service_hours,
    last_service_hours
  ON public.vehicle_maintenance
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_vehicle_maintenance_service_state();
