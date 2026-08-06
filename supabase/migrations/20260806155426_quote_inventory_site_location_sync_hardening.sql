BEGIN;

CREATE OR REPLACE FUNCTION private.archive_site_location_if_empty(
  p_location_id UUID,
  p_actor_user_id UUID DEFAULT NULL,
  p_force_source_type TEXT DEFAULT NULL,
  p_force_source_id UUID DEFAULT NULL,
  p_force_external_reference TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_updated INTEGER := 0;
BEGIN
  -- Serialize on the location row, then archive only when no protected stock exists
  -- at write time (closes the check-then-act race with concurrent stock moves).
  PERFORM 1
  FROM public.inventory_locations
  WHERE id = p_location_id
  FOR UPDATE;

  UPDATE public.inventory_locations AS loc
  SET
    is_active = FALSE,
    sync_status = 'archived',
    source_type = COALESCE(p_force_source_type, loc.source_type),
    source_id = COALESCE(p_force_source_id, loc.source_id),
    external_reference = COALESCE(p_force_external_reference, loc.external_reference),
    source_synced_at = v_now,
    updated_by = COALESCE(p_actor_user_id, loc.updated_by),
    updated_at = v_now
  WHERE loc.id = p_location_id
    AND loc.is_active = TRUE
    AND NOT EXISTS (
      SELECT 1
      FROM public.inventory_items item
      WHERE item.location_id = loc.id
        AND item.status = 'active'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.inventory_hardware_balances balance
      WHERE balance.location_id = loc.id
        AND balance.quantity > 0
    );

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 1 THEN
    RETURN TRUE;
  END IF;

  IF private.site_location_has_protected_stock(p_location_id) THEN
    RAISE EXCEPTION
      'Cannot archive site location % while protected stock remains.',
      p_location_id;
  END IF;

  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION private.reconcile_quote_site_location(
  p_reference TEXT,
  p_actor_user_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reference TEXT := private.normalize_site_reference(p_reference);
  v_quote public.quotes%ROWTYPE;
  v_location public.inventory_locations%ROWTYPE;
  v_should_active BOOLEAN;
  v_should_archive BOOLEAN;
  v_name TEXT;
  v_description TEXT;
  v_now TIMESTAMPTZ := NOW();
  v_can_adopt_project BOOLEAN := FALSE;
BEGIN
  IF v_reference IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('quote-site-location:' || v_reference, 0));

  SELECT loc.*
  INTO v_location
  FROM public.inventory_locations AS loc
  WHERE loc.location_type = 'site'
    AND private.normalize_site_reference(loc.external_reference) = v_reference
  ORDER BY loc.is_active DESC, loc.updated_at DESC, loc.id DESC
  LIMIT 1
  FOR UPDATE;

  IF private.is_retired_quote_reference(v_reference) THEN
    IF v_location.id IS NOT NULL AND v_location.is_active THEN
      PERFORM private.archive_site_location_if_empty(
        v_location.id,
        p_actor_user_id,
        'quote',
        v_location.source_id,
        v_reference
      );
    END IF;
    RETURN v_location.id;
  END IF;

  v_quote := private.get_canonical_quote_for_reference(v_reference);

  -- No canonical quote for this reference (delete/rename/orphan): archive quote/project
  -- owned active sites so old references do not remain selectable.
  IF v_quote.id IS NULL THEN
    IF v_location.id IS NOT NULL
       AND v_location.is_active
       AND v_location.source_type IN ('quote', 'legacy_quote', 'project_number') THEN
      PERFORM private.archive_site_location_if_empty(
        v_location.id,
        p_actor_user_id,
        v_location.source_type,
        v_location.source_id,
        v_reference
      );
    END IF;
    RETURN v_location.id;
  END IF;

  v_should_active := private.quote_should_have_active_site(v_quote.status, v_quote.commercial_status);
  v_should_archive := private.quote_should_archive_site(v_quote.status, v_quote.commercial_status);

  IF v_location.id IS NOT NULL
     AND v_location.source_type IS DISTINCT FROM 'quote'
     AND v_location.source_type IS DISTINCT FROM 'legacy_quote' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.quote_project_numbers project
      WHERE private.normalize_site_reference(project.project_reference) = v_reference
        AND project.status = 'converted'
        AND project.converted_quote_id = v_quote.id
        AND v_location.source_type = 'project_number'
        AND (
          v_location.source_id IS NULL
          OR v_location.source_id = project.id
        )
    )
    INTO v_can_adopt_project;

    IF NOT v_can_adopt_project THEN
      RAISE EXCEPTION
        'Site reference % is owned by source_type=%; refusing quote reconciliation.',
        v_reference,
        COALESCE(v_location.source_type, 'null');
    END IF;
  END IF;

  IF NOT v_should_active AND NOT v_should_archive THEN
    RETURN v_location.id;
  END IF;

  v_name := private.build_site_location_name(
    v_reference,
    private.quote_site_location_label(v_quote.site_address, v_quote.subject_line)
  );
  v_description := COALESCE(NULLIF(BTRIM(v_quote.site_address), ''), NULLIF(BTRIM(v_quote.subject_line), ''));

  IF v_should_archive THEN
    IF v_location.id IS NULL OR NOT v_location.is_active THEN
      RETURN v_location.id;
    END IF;

    PERFORM private.archive_site_location_if_empty(
      v_location.id,
      p_actor_user_id,
      'quote',
      v_quote.id,
      v_reference
    );
    RETURN v_location.id;
  END IF;

  IF v_location.id IS NULL THEN
    INSERT INTO public.inventory_locations (
      name,
      description,
      is_active,
      location_type,
      source_type,
      source_id,
      external_reference,
      sync_status,
      source_synced_at,
      linked_van_id,
      linked_hgv_id,
      linked_plant_id,
      created_by,
      updated_by
    ) VALUES (
      v_name,
      v_description,
      TRUE,
      'site',
      'quote',
      v_quote.id,
      v_reference,
      'synced',
      v_now,
      NULL,
      NULL,
      NULL,
      p_actor_user_id,
      p_actor_user_id
    )
    RETURNING id INTO v_location.id;

    RETURN v_location.id;
  END IF;

  UPDATE public.inventory_locations
  SET
    name = v_name,
    description = v_description,
    is_active = TRUE,
    location_type = 'site',
    source_type = 'quote',
    source_id = v_quote.id,
    external_reference = v_reference,
    sync_status = 'synced',
    source_synced_at = v_now,
    linked_van_id = NULL,
    linked_hgv_id = NULL,
    linked_plant_id = NULL,
    updated_by = COALESCE(p_actor_user_id, updated_by),
    updated_at = v_now
  WHERE id = v_location.id
    AND (
      name IS DISTINCT FROM v_name
      OR description IS DISTINCT FROM v_description
      OR is_active IS DISTINCT FROM TRUE
      OR source_type IS DISTINCT FROM 'quote'
      OR source_id IS DISTINCT FROM v_quote.id
      OR external_reference IS DISTINCT FROM v_reference
      OR sync_status IS DISTINCT FROM 'synced'
    );

  RETURN v_location.id;
END;
$$;

CREATE OR REPLACE FUNCTION private.reconcile_project_number_site_location(
  p_reference TEXT,
  p_actor_user_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reference TEXT := private.normalize_site_reference(p_reference);
  v_project public.quote_project_numbers%ROWTYPE;
  v_location public.inventory_locations%ROWTYPE;
  v_now TIMESTAMPTZ := NOW();
  v_name TEXT;
  v_description TEXT;
BEGIN
  IF v_reference IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('quote-site-location:' || v_reference, 0));

  SELECT project.*
  INTO v_project
  FROM public.quote_project_numbers AS project
  WHERE private.normalize_site_reference(project.project_reference) = v_reference
  ORDER BY
    CASE project.status
      WHEN 'open' THEN 0
      WHEN 'converted' THEN 1
      WHEN 'merged' THEN 2
      WHEN 'cancelled' THEN 3
      ELSE 4
    END,
    project.updated_at DESC,
    project.id DESC
  LIMIT 1;

  SELECT loc.*
  INTO v_location
  FROM public.inventory_locations AS loc
  WHERE loc.location_type = 'site'
    AND private.normalize_site_reference(loc.external_reference) = v_reference
  ORDER BY loc.is_active DESC, loc.updated_at DESC, loc.id DESC
  LIMIT 1
  FOR UPDATE;

  IF v_project.id IS NULL THEN
    IF v_location.id IS NOT NULL
       AND v_location.is_active
       AND v_location.source_type = 'project_number' THEN
      PERFORM private.archive_site_location_if_empty(v_location.id, p_actor_user_id);
    END IF;
    RETURN v_location.id;
  END IF;

  IF v_project.status = 'converted' THEN
    RETURN private.reconcile_quote_site_location(v_reference, p_actor_user_id);
  END IF;

  IF v_location.id IS NOT NULL
     AND v_location.source_type = 'quote' THEN
    RETURN v_location.id;
  END IF;

  IF v_project.status = 'open' THEN
    v_name := private.build_site_location_name(
      v_reference,
      COALESCE(NULLIF(BTRIM(v_project.title), ''), NULLIF(BTRIM(v_project.description), ''))
    );
    v_description := COALESCE(NULLIF(BTRIM(v_project.description), ''), NULLIF(BTRIM(v_project.title), ''));

    IF v_location.id IS NULL THEN
      INSERT INTO public.inventory_locations (
        name,
        description,
        is_active,
        location_type,
        source_type,
        source_id,
        external_reference,
        sync_status,
        source_synced_at,
        linked_van_id,
        linked_hgv_id,
        linked_plant_id,
        created_by,
        updated_by
      ) VALUES (
        v_name,
        v_description,
        TRUE,
        'site',
        'project_number',
        v_project.id,
        v_reference,
        'synced',
        v_now,
        NULL,
        NULL,
        NULL,
        p_actor_user_id,
        p_actor_user_id
      )
      RETURNING id INTO v_location.id;
      RETURN v_location.id;
    END IF;

    IF v_location.source_type IS DISTINCT FROM 'project_number'
       AND v_location.source_type IS DISTINCT FROM NULL THEN
      RAISE EXCEPTION
        'Project site reference % is owned by source_type=%; refusing project reconciliation.',
        v_reference,
        COALESCE(v_location.source_type, 'null');
    END IF;

    UPDATE public.inventory_locations
    SET
      name = v_name,
      description = v_description,
      is_active = TRUE,
      location_type = 'site',
      source_type = 'project_number',
      source_id = v_project.id,
      external_reference = v_reference,
      sync_status = 'synced',
      source_synced_at = v_now,
      linked_van_id = NULL,
      linked_hgv_id = NULL,
      linked_plant_id = NULL,
      updated_by = COALESCE(p_actor_user_id, updated_by),
      updated_at = v_now
    WHERE id = v_location.id;

    RETURN v_location.id;
  END IF;

  IF v_location.id IS NULL OR NOT v_location.is_active THEN
    RETURN v_location.id;
  END IF;

  IF v_location.source_type IS DISTINCT FROM 'project_number' THEN
    RETURN v_location.id;
  END IF;

  PERFORM private.archive_site_location_if_empty(v_location.id, p_actor_user_id);
  RETURN v_location.id;
END;
$$;

REVOKE ALL ON FUNCTION private.archive_site_location_if_empty(UUID, UUID, TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.reconcile_quote_site_location(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.reconcile_project_number_site_location(TEXT, UUID) FROM PUBLIC;

DO $$
DECLARE
  v_target_id UUID;
BEGIN
  SELECT id
  INTO v_target_id
  FROM public.inventory_locations
  WHERE location_type = 'site'
    AND is_active = TRUE
    AND source_type = 'quote'
    AND private.normalize_site_reference(external_reference) = '40106-GH';

  IF v_target_id IS DISTINCT FROM '8ccad4c8-b6fc-45a9-9f6d-edb685be3341'::UUID THEN
    RAISE EXCEPTION
      'Hardening postcondition failed: expected 40106-GH location id 8ccad4c8-b6fc-45a9-9f6d-edb685be3341, found %.',
      COALESCE(v_target_id::TEXT, 'null');
  END IF;
END;
$$;

COMMIT;
