BEGIN;

CREATE OR REPLACE FUNCTION public.inventory_set_user_location_with_assignment(
  p_user_id UUID,
  p_location_id UUID,
  p_change_reason TEXT,
  p_actor_user_id UUID
)
RETURNS TABLE(user_id UUID, location_id UUID)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_location public.inventory_locations%ROWTYPE;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  SELECT *
  INTO v_location
  FROM public.inventory_locations
  WHERE id = p_location_id
    AND is_active = TRUE
  FOR UPDATE;

  IF v_location.id IS NULL THEN
    RAISE EXCEPTION 'Inventory location not found';
  END IF;

  INSERT INTO public.inventory_user_locations (
    user_id,
    location_id,
    change_reason,
    updated_by
  )
  VALUES (
    p_user_id,
    p_location_id,
    NULLIF(BTRIM(COALESCE(p_change_reason, '')), ''),
    p_actor_user_id
  )
  ON CONFLICT ON CONSTRAINT inventory_user_locations_pkey DO UPDATE
  SET location_id = EXCLUDED.location_id,
      change_reason = EXCLUDED.change_reason,
      updated_by = EXCLUDED.updated_by,
      updated_at = v_now;

  UPDATE public.profile_fleet_assignments
  SET ended_at = v_now,
      ended_by = p_actor_user_id,
      updated_at = v_now
  WHERE profile_fleet_assignments.user_id = p_user_id
    AND profile_fleet_assignments.ended_at IS NULL;

  IF v_location.linked_van_id IS NOT NULL
     OR v_location.linked_hgv_id IS NOT NULL
     OR v_location.linked_plant_id IS NOT NULL THEN
    INSERT INTO public.profile_fleet_assignments (
      user_id,
      linked_van_id,
      linked_hgv_id,
      linked_plant_id,
      source,
      source_location_id,
      change_reason,
      assigned_by
    )
    VALUES (
      p_user_id,
      v_location.linked_van_id,
      v_location.linked_hgv_id,
      v_location.linked_plant_id,
      'inventory_location',
      v_location.id,
      NULLIF(BTRIM(COALESCE(p_change_reason, '')), ''),
      p_actor_user_id
    );
  END IF;

  RETURN QUERY
  SELECT inventory_user_locations.user_id, inventory_user_locations.location_id
  FROM public.inventory_user_locations
  WHERE inventory_user_locations.user_id = p_user_id;
END;
$$;

COMMIT;
