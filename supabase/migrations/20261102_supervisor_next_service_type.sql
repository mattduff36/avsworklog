-- finalise-phase: predeploy
-- Owner-authorised: maintenance Level 3 (Supervisor) may edit next service type only.
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

  -- Supervisor-level maintenance editors may change only the next type/cursor.
  -- Keep inserts, meter corrections and historical service fields manager-only.
  IF NEW.last_service_template_id IS NOT DISTINCT FROM OLD.last_service_template_id
    AND NEW.next_service_mileage IS NOT DISTINCT FROM OLD.next_service_mileage
    AND NEW.last_service_mileage IS NOT DISTINCT FROM OLD.last_service_mileage
    AND NEW.next_service_hours IS NOT DISTINCT FROM OLD.next_service_hours
    AND NEW.last_service_hours IS NOT DISTINCT FROM OLD.last_service_hours
    AND NEW.van_id IS NOT DISTINCT FROM OLD.van_id
    AND NEW.hgv_id IS NOT DISTINCT FROM OLD.hgv_id
    AND NEW.plant_id IS NOT DISTINCT FROM OLD.plant_id
    AND COALESCE(public.effective_has_module_level('maintenance', 3), FALSE)
  THEN
    IF NEW.next_service_template_id IS NULL AND NEW.next_service_rotation_step_id IS NULL THEN
      RETURN NEW;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.service_rotation_steps s
      JOIN public.maintenance_categories mc ON mc.id = s.maintenance_category_id
      JOIN public.workshop_attachment_templates t ON t.id = s.attachment_template_id
      JOIN public.workshop_category_attachment_templates link
        ON link.category_id = mc.workshop_category_id AND link.template_id = t.id
      WHERE s.id = NEW.next_service_rotation_step_id
        AND t.id = NEW.next_service_template_id AND t.is_active AND mc.is_active
        AND mc.config_key = CASE WHEN NEW.hgv_id IS NOT NULL THEN 'service_hgv'
          WHEN NEW.plant_id IS NOT NULL THEN 'service_plant' ELSE 'service_van' END
        AND EXISTS (SELECT 1 FROM public.workshop_attachment_template_versions v
          WHERE v.template_id = t.id AND v.status = 'published')
    ) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Selected next service type and rotation must match an active published service for this asset'
      USING ERRCODE = '23514';
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

