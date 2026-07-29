BEGIN;

-- Clear current fleet assignment(s) for a linked asset and remove matching inventory_user_locations.
CREATE OR REPLACE FUNCTION public.clear_fleet_assignment_for_asset(
  p_asset_type TEXT,
  p_asset_id UUID,
  p_actor_user_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_location_id UUID;
  v_ended INTEGER := 0;
BEGIN
  IF p_asset_type NOT IN ('van', 'hgv', 'plant') THEN
    RAISE EXCEPTION 'Invalid asset type: %', p_asset_type;
  END IF;

  IF p_asset_id IS NULL THEN
    RAISE EXCEPTION 'Asset id is required';
  END IF;

  SELECT location.id
  INTO v_location_id
  FROM public.inventory_locations location
  WHERE location.is_active = TRUE
    AND (
      (p_asset_type = 'van' AND location.linked_van_id = p_asset_id)
      OR (p_asset_type = 'hgv' AND location.linked_hgv_id = p_asset_id)
      OR (p_asset_type = 'plant' AND location.linked_plant_id = p_asset_id)
    )
  ORDER BY location.updated_at DESC NULLS LAST
  LIMIT 1;

  IF v_location_id IS NOT NULL THEN
    DELETE FROM public.inventory_user_locations
    WHERE location_id = v_location_id;
  END IF;

  UPDATE public.profile_fleet_assignments assignment
  SET ended_at = v_now,
      ended_by = p_actor_user_id,
      updated_at = v_now
  WHERE assignment.ended_at IS NULL
    AND (
      (p_asset_type = 'van' AND assignment.linked_van_id = p_asset_id)
      OR (p_asset_type = 'hgv' AND assignment.linked_hgv_id = p_asset_id)
      OR (p_asset_type = 'plant' AND assignment.linked_plant_id = p_asset_id)
    );

  GET DIAGNOSTICS v_ended = ROW_COUNT;
  RETURN v_ended;
END;
$$;

-- Ensure one active inventory location exists for a fleet asset.
CREATE OR REPLACE FUNCTION public.ensure_fleet_inventory_location(
  p_asset_type TEXT,
  p_asset_id UUID,
  p_actor_user_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_location_id UUID;
  v_name TEXT;
  v_description TEXT;
  v_reference TEXT;
  v_nickname TEXT;
BEGIN
  IF p_asset_type NOT IN ('van', 'hgv', 'plant') THEN
    RAISE EXCEPTION 'Invalid asset type: %', p_asset_type;
  END IF;

  SELECT location.id
  INTO v_location_id
  FROM public.inventory_locations location
  WHERE (
      (p_asset_type = 'van' AND location.linked_van_id = p_asset_id)
      OR (p_asset_type = 'hgv' AND location.linked_hgv_id = p_asset_id)
      OR (p_asset_type = 'plant' AND location.linked_plant_id = p_asset_id)
    )
  ORDER BY location.is_active DESC, location.updated_at DESC NULLS LAST
  LIMIT 1
  FOR UPDATE;

  IF p_asset_type = 'van' THEN
    SELECT van.reg_number, van.nickname
    INTO v_reference, v_nickname
    FROM public.vans van
    WHERE van.id = p_asset_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Van not found';
    END IF;

    v_name := 'Van - ' || BTRIM(COALESCE(v_reference, 'Unknown'));
    v_description := CASE
      WHEN NULLIF(BTRIM(COALESCE(v_nickname, '')), '') IS NULL THEN 'Synced from active fleet van.'
      ELSE 'Synced from active fleet van: ' || BTRIM(v_nickname)
    END;
  ELSIF p_asset_type = 'hgv' THEN
    SELECT hgv.reg_number, hgv.nickname
    INTO v_reference, v_nickname
    FROM public.hgvs hgv
    WHERE hgv.id = p_asset_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'HGV not found';
    END IF;

    v_name := 'HGV - ' || BTRIM(COALESCE(v_reference, 'Unknown'));
    v_description := CASE
      WHEN NULLIF(BTRIM(COALESCE(v_nickname, '')), '') IS NULL THEN 'Synced from active fleet HGV.'
      ELSE 'Synced from active fleet HGV: ' || BTRIM(v_nickname)
    END;
  ELSE
    SELECT COALESCE(plant.plant_id, plant.reg_number), plant.nickname
    INTO v_reference, v_nickname
    FROM public.plant plant
    WHERE plant.id = p_asset_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Plant not found';
    END IF;

    v_name := 'Plant - ' || BTRIM(COALESCE(v_reference, 'Unknown'));
    v_description := CASE
      WHEN NULLIF(BTRIM(COALESCE(v_nickname, '')), '') IS NULL THEN 'Synced from active fleet plant.'
      ELSE 'Synced from active fleet plant: ' || BTRIM(v_nickname)
    END;
  END IF;

  IF v_location_id IS NOT NULL THEN
    UPDATE public.inventory_locations
    SET name = v_name,
        description = v_description,
        is_active = TRUE,
        location_type = p_asset_type,
        source_type = 'fleet',
        sync_status = 'synced',
        source_synced_at = NOW(),
        linked_van_id = CASE WHEN p_asset_type = 'van' THEN p_asset_id ELSE NULL END,
        linked_hgv_id = CASE WHEN p_asset_type = 'hgv' THEN p_asset_id ELSE NULL END,
        linked_plant_id = CASE WHEN p_asset_type = 'plant' THEN p_asset_id ELSE NULL END,
        updated_by = p_actor_user_id,
        updated_at = NOW()
    WHERE id = v_location_id;

    RETURN v_location_id;
  END IF;

  INSERT INTO public.inventory_locations (
    name,
    description,
    is_active,
    location_type,
    source_type,
    sync_status,
    source_synced_at,
    linked_van_id,
    linked_hgv_id,
    linked_plant_id,
    created_by,
    updated_by
  )
  VALUES (
    v_name,
    v_description,
    TRUE,
    p_asset_type,
    'fleet',
    'synced',
    NOW(),
    CASE WHEN p_asset_type = 'van' THEN p_asset_id ELSE NULL END,
    CASE WHEN p_asset_type = 'hgv' THEN p_asset_id ELSE NULL END,
    CASE WHEN p_asset_type = 'plant' THEN p_asset_id ELSE NULL END,
    p_actor_user_id,
    p_actor_user_id
  )
  RETURNING id INTO v_location_id;

  RETURN v_location_id;
END;
$$;

-- Atomic nickname + assignment update for admin asset editors.
CREATE OR REPLACE FUNCTION public.admin_apply_fleet_asset_nickname_assignment(
  p_asset_type TEXT,
  p_asset_id UUID,
  p_manual_nickname TEXT,
  p_assignment_action TEXT,
  p_assigned_user_id UUID,
  p_expected_assignment_id UUID,
  p_actor_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
  v_current_assignment_id UUID;
  v_current_user_id UUID;
  v_nickname TEXT;
  v_profile_name TEXT;
  v_location_id UUID;
  v_result_assignment_id UUID;
BEGIN
  IF p_asset_type NOT IN ('van', 'hgv', 'plant') THEN
    RAISE EXCEPTION 'Invalid asset type: %', p_asset_type;
  END IF;

  IF p_assignment_action NOT IN ('keep', 'clear', 'assign') THEN
    RAISE EXCEPTION 'Invalid assignment action: %', p_assignment_action;
  END IF;

  IF p_asset_type = 'van' THEN
    SELECT van.status INTO v_status FROM public.vans van WHERE van.id = p_asset_id FOR UPDATE;
  ELSIF p_asset_type = 'hgv' THEN
    SELECT hgv.status INTO v_status FROM public.hgvs hgv WHERE hgv.id = p_asset_id FOR UPDATE;
  ELSE
    SELECT plant.status INTO v_status FROM public.plant plant WHERE plant.id = p_asset_id FOR UPDATE;
  END IF;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Asset not found';
  END IF;

  SELECT assignment.id, assignment.user_id
  INTO v_current_assignment_id, v_current_user_id
  FROM public.profile_fleet_assignments assignment
  WHERE assignment.ended_at IS NULL
    AND (
      (p_asset_type = 'van' AND assignment.linked_van_id = p_asset_id)
      OR (p_asset_type = 'hgv' AND assignment.linked_hgv_id = p_asset_id)
      OR (p_asset_type = 'plant' AND assignment.linked_plant_id = p_asset_id)
    )
  FOR UPDATE;

  IF v_current_assignment_id IS DISTINCT FROM p_expected_assignment_id THEN
    RAISE EXCEPTION 'STALE_ASSIGNMENT: Current assignment changed. Refresh and try again.';
  END IF;

  IF p_assignment_action = 'assign' THEN
    IF p_assigned_user_id IS NULL THEN
      RAISE EXCEPTION 'assigned_user_id is required for assign';
    END IF;

    IF v_status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'Cannot assign a user to a non-active asset';
    END IF;

    SELECT NULLIF(BTRIM(COALESCE(profile.full_name, '')), '')
    INTO v_profile_name
    FROM public.profiles profile
    WHERE profile.id = p_assigned_user_id
      AND COALESCE(profile.is_placeholder, FALSE) = FALSE
      AND profile.full_name NOT ILIKE '%(Deleted User)%'
    FOR UPDATE;

    IF v_profile_name IS NULL THEN
      RAISE EXCEPTION 'Assigned user not found or inactive';
    END IF;

    v_nickname := v_profile_name;
  ELSE
    v_nickname := NULLIF(BTRIM(COALESCE(p_manual_nickname, '')), '');
  END IF;

  IF p_asset_type = 'van' THEN
    UPDATE public.vans SET nickname = v_nickname WHERE id = p_asset_id;
  ELSIF p_asset_type = 'hgv' THEN
    UPDATE public.hgvs SET nickname = v_nickname WHERE id = p_asset_id;
  ELSE
    UPDATE public.plant SET nickname = v_nickname WHERE id = p_asset_id;
  END IF;

  IF p_assignment_action = 'keep' THEN
    RETURN jsonb_build_object(
      'nickname', v_nickname,
      'assignment_id', v_current_assignment_id,
      'assigned_user_id', v_current_user_id,
      'action', 'keep'
    );
  END IF;

  IF p_assignment_action = 'clear' THEN
    PERFORM public.clear_fleet_assignment_for_asset(p_asset_type, p_asset_id, p_actor_user_id);
    RETURN jsonb_build_object(
      'nickname', v_nickname,
      'assignment_id', NULL,
      'assigned_user_id', NULL,
      'action', 'clear'
    );
  END IF;

  -- assign
  IF v_current_user_id IS NOT NULL AND v_current_user_id IS DISTINCT FROM p_assigned_user_id THEN
    PERFORM public.clear_fleet_assignment_for_asset(p_asset_type, p_asset_id, p_actor_user_id);
  END IF;

  v_location_id := public.ensure_fleet_inventory_location(p_asset_type, p_asset_id, p_actor_user_id);

  PERFORM public.inventory_set_user_location_with_assignment(
    p_assigned_user_id,
    v_location_id,
    'Assigned from asset nickname editor',
    p_actor_user_id
  );

  SELECT assignment.id
  INTO v_result_assignment_id
  FROM public.profile_fleet_assignments assignment
  WHERE assignment.ended_at IS NULL
    AND assignment.user_id = p_assigned_user_id
    AND (
      (p_asset_type = 'van' AND assignment.linked_van_id = p_asset_id)
      OR (p_asset_type = 'hgv' AND assignment.linked_hgv_id = p_asset_id)
      OR (p_asset_type = 'plant' AND assignment.linked_plant_id = p_asset_id)
    );

  RETURN jsonb_build_object(
    'nickname', v_nickname,
    'assignment_id', v_result_assignment_id,
    'assigned_user_id', p_assigned_user_id,
    'action', 'assign',
    'location_id', v_location_id
  );
END;
$$;

-- Auto-clear assignments when assets leave active service.
CREATE OR REPLACE FUNCTION public.trg_clear_fleet_assignment_on_asset_inactive()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_asset_type TEXT;
BEGIN
  IF TG_TABLE_NAME = 'vans' THEN
    v_asset_type := 'van';
  ELSIF TG_TABLE_NAME = 'hgvs' THEN
    v_asset_type := 'hgv';
  ELSIF TG_TABLE_NAME = 'plant' THEN
    v_asset_type := 'plant';
  ELSE
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('retired', 'archived') THEN
    PERFORM public.clear_fleet_assignment_for_asset(v_asset_type, NEW.id, NULL);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_fleet_assignment_on_van_inactive ON public.vans;
CREATE TRIGGER trg_clear_fleet_assignment_on_van_inactive
AFTER UPDATE OF status ON public.vans
FOR EACH ROW
EXECUTE FUNCTION public.trg_clear_fleet_assignment_on_asset_inactive();

DROP TRIGGER IF EXISTS trg_clear_fleet_assignment_on_hgv_inactive ON public.hgvs;
CREATE TRIGGER trg_clear_fleet_assignment_on_hgv_inactive
AFTER UPDATE OF status ON public.hgvs
FOR EACH ROW
EXECUTE FUNCTION public.trg_clear_fleet_assignment_on_asset_inactive();

DROP TRIGGER IF EXISTS trg_clear_fleet_assignment_on_plant_inactive ON public.plant;
CREATE TRIGGER trg_clear_fleet_assignment_on_plant_inactive
AFTER UPDATE OF status ON public.plant
FOR EACH ROW
EXECUTE FUNCTION public.trg_clear_fleet_assignment_on_asset_inactive();

REVOKE ALL ON FUNCTION public.clear_fleet_assignment_for_asset(TEXT, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.clear_fleet_assignment_for_asset(TEXT, UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.clear_fleet_assignment_for_asset(TEXT, UUID, UUID) FROM authenticated;
REVOKE ALL ON FUNCTION public.ensure_fleet_inventory_location(TEXT, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_fleet_inventory_location(TEXT, UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.ensure_fleet_inventory_location(TEXT, UUID, UUID) FROM authenticated;
REVOKE ALL ON FUNCTION public.admin_apply_fleet_asset_nickname_assignment(TEXT, UUID, TEXT, TEXT, UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_apply_fleet_asset_nickname_assignment(TEXT, UUID, TEXT, TEXT, UUID, UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.admin_apply_fleet_asset_nickname_assignment(TEXT, UUID, TEXT, TEXT, UUID, UUID, UUID) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.clear_fleet_assignment_for_asset(TEXT, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.ensure_fleet_inventory_location(TEXT, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_apply_fleet_asset_nickname_assignment(TEXT, UUID, TEXT, TEXT, UUID, UUID, UUID) TO service_role;

COMMIT;
