BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.normalize_site_reference(p_reference TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT NULLIF(UPPER(BTRIM(p_reference)), '');
$$;

CREATE OR REPLACE FUNCTION private.quote_should_have_active_site(
  p_status TEXT,
  p_commercial_status TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT p_commercial_status IS DISTINCT FROM 'closed'
    AND p_status IS DISTINCT FROM 'lost'
    AND p_status IS DISTINCT FROM 'closed';
$$;

CREATE OR REPLACE FUNCTION private.quote_should_archive_site(
  p_status TEXT,
  p_commercial_status TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT p_commercial_status = 'closed'
    OR p_status IN ('lost', 'closed');
$$;

CREATE OR REPLACE FUNCTION private.site_location_has_protected_stock(p_location_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.inventory_items item
    WHERE item.location_id = p_location_id
      AND item.status = 'active'
  )
  OR EXISTS (
    SELECT 1
    FROM public.inventory_hardware_balances balance
    WHERE balance.location_id = p_location_id
      AND balance.quantity > 0
  );
$$;

CREATE OR REPLACE FUNCTION private.quote_site_location_label(
  p_site_address TEXT,
  p_subject_line TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_line TEXT;
BEGIN
  IF p_site_address IS NOT NULL THEN
    FOREACH v_line IN ARRAY string_to_array(p_site_address, E'\n')
    LOOP
      v_line := BTRIM(v_line);
      IF v_line <> '' THEN
        RETURN v_line;
      END IF;
    END LOOP;
  END IF;

  RETURN NULLIF(BTRIM(p_subject_line), '');
END;
$$;

CREATE OR REPLACE FUNCTION private.build_site_location_name(
  p_reference TEXT,
  p_label TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN NULLIF(BTRIM(p_label), '') IS NULL THEN 'Site - ' || p_reference
    ELSE 'Site - ' || p_reference || ' - ' || BTRIM(p_label)
  END;
$$;

CREATE OR REPLACE FUNCTION private.is_retired_quote_reference(p_reference TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.quote_reference_aliases alias
    WHERE alias.alias_reference = private.normalize_site_reference(p_reference)
  )
  OR EXISTS (
    SELECT 1
    FROM public.quote_merge_members member
    WHERE UPPER(BTRIM(member.base_quote_reference)) = private.normalize_site_reference(p_reference)
      AND member.is_survivor = FALSE
  );
$$;

CREATE OR REPLACE FUNCTION private.get_canonical_quote_for_reference(p_reference TEXT)
RETURNS public.quotes
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reference TEXT := private.normalize_site_reference(p_reference);
  v_quote public.quotes%ROWTYPE;
BEGIN
  IF v_reference IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT quote.*
  INTO v_quote
  FROM public.quotes AS quote
  WHERE private.normalize_site_reference(COALESCE(quote.base_quote_reference, quote.quote_reference)) = v_reference
    AND NOT EXISTS (
      SELECT 1
      FROM public.quote_reference_aliases alias
      WHERE alias.alias_reference = v_reference
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.quote_merge_members member
      WHERE member.quote_thread_id = quote.quote_thread_id
        AND member.is_survivor = FALSE
    )
  ORDER BY
    quote.is_latest_version DESC,
    quote.revision_number DESC,
    quote.created_at DESC,
    quote.id DESC
  LIMIT 1;

  RETURN v_quote;
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

  IF private.is_retired_quote_reference(v_reference) THEN
    SELECT loc.*
    INTO v_location
    FROM public.inventory_locations AS loc
    WHERE loc.location_type = 'site'
      AND private.normalize_site_reference(loc.external_reference) = v_reference
    ORDER BY loc.is_active DESC, loc.updated_at DESC, loc.id DESC
    LIMIT 1
    FOR UPDATE;

    IF v_location.id IS NULL THEN
      RETURN NULL;
    END IF;

    IF v_location.is_active THEN
      IF private.site_location_has_protected_stock(v_location.id) THEN
        RAISE EXCEPTION
          'Cannot archive site location % for retired reference % while protected stock remains.',
          v_location.id,
          v_reference;
      END IF;

      UPDATE public.inventory_locations
      SET
        is_active = FALSE,
        sync_status = 'archived',
        source_synced_at = v_now,
        updated_by = COALESCE(p_actor_user_id, updated_by),
        updated_at = v_now
      WHERE id = v_location.id;
    END IF;

    RETURN v_location.id;
  END IF;

  v_quote := private.get_canonical_quote_for_reference(v_reference);
  IF v_quote.id IS NULL THEN
    RETURN NULL;
  END IF;

  v_should_active := private.quote_should_have_active_site(v_quote.status, v_quote.commercial_status);
  v_should_archive := private.quote_should_archive_site(v_quote.status, v_quote.commercial_status);

  SELECT loc.*
  INTO v_location
  FROM public.inventory_locations AS loc
  WHERE loc.location_type = 'site'
    AND private.normalize_site_reference(loc.external_reference) = v_reference
  ORDER BY loc.is_active DESC, loc.updated_at DESC, loc.id DESC
  LIMIT 1
  FOR UPDATE;

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

    IF private.site_location_has_protected_stock(v_location.id) THEN
      RAISE EXCEPTION
        'Cannot archive site location % for quote % while protected stock remains.',
        v_location.id,
        v_reference;
    END IF;

    UPDATE public.inventory_locations
    SET
      is_active = FALSE,
      sync_status = 'archived',
      source_type = 'quote',
      source_id = v_quote.id,
      external_reference = v_reference,
      source_synced_at = v_now,
      updated_by = COALESCE(p_actor_user_id, updated_by),
      updated_at = v_now
    WHERE id = v_location.id;

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

  IF v_project.id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Converted survivors are owned by the quote reconciler.
  IF v_project.status = 'converted' THEN
    RETURN private.reconcile_quote_site_location(v_reference, p_actor_user_id);
  END IF;

  SELECT loc.*
  INTO v_location
  FROM public.inventory_locations AS loc
  WHERE loc.location_type = 'site'
    AND private.normalize_site_reference(loc.external_reference) = v_reference
  ORDER BY loc.is_active DESC, loc.updated_at DESC, loc.id DESC
  LIMIT 1
  FOR UPDATE;

  IF v_location.id IS NOT NULL
     AND v_location.source_type = 'quote' THEN
    -- Never archive/overwrite a quote-owned survivor.
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

  -- cancelled / merged aliases archive when empty and project-owned.
  IF v_location.id IS NULL OR NOT v_location.is_active THEN
    RETURN v_location.id;
  END IF;

  IF v_location.source_type IS DISTINCT FROM 'project_number' THEN
    RETURN v_location.id;
  END IF;

  IF private.site_location_has_protected_stock(v_location.id) THEN
    RAISE EXCEPTION
      'Cannot archive project site % for % while protected stock remains.',
      v_location.id,
      v_reference;
  END IF;

  UPDATE public.inventory_locations
  SET
    is_active = FALSE,
    sync_status = 'archived',
    source_synced_at = v_now,
    updated_by = COALESCE(p_actor_user_id, updated_by),
    updated_at = v_now
  WHERE id = v_location.id;

  RETURN v_location.id;
END;
$$;

CREATE OR REPLACE FUNCTION private.trg_reconcile_quote_site_location()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_old_reference TEXT;
  v_new_reference TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_actor := OLD.updated_by;
    v_old_reference := private.normalize_site_reference(COALESCE(OLD.base_quote_reference, OLD.quote_reference));
    IF v_old_reference IS NOT NULL THEN
      PERFORM private.reconcile_quote_site_location(v_old_reference, v_actor);
    END IF;
    RETURN OLD;
  END IF;

  v_actor := COALESCE(NEW.updated_by, NEW.created_by);
  v_new_reference := private.normalize_site_reference(COALESCE(NEW.base_quote_reference, NEW.quote_reference));
  v_old_reference := CASE
    WHEN TG_OP = 'UPDATE' THEN private.normalize_site_reference(COALESCE(OLD.base_quote_reference, OLD.quote_reference))
    ELSE NULL
  END;

  IF v_old_reference IS NOT NULL AND v_old_reference IS DISTINCT FROM v_new_reference THEN
    PERFORM private.reconcile_quote_site_location(v_old_reference, v_actor);
  END IF;

  IF v_new_reference IS NOT NULL THEN
    PERFORM private.reconcile_quote_site_location(v_new_reference, v_actor);
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.trg_reconcile_quote_merge_site_location()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.quote_merge_members%ROWTYPE;
BEGIN
  v_row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  PERFORM private.reconcile_quote_site_location(v_row.base_quote_reference, NULL);
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION private.trg_reconcile_project_number_site_location()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_old_reference TEXT;
  v_new_reference TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_old_reference := private.normalize_site_reference(OLD.project_reference);
    IF v_old_reference IS NOT NULL THEN
      PERFORM private.reconcile_project_number_site_location(v_old_reference, OLD.updated_by);
    END IF;
    RETURN OLD;
  END IF;

  v_actor := COALESCE(NEW.updated_by, NEW.created_by);
  v_new_reference := private.normalize_site_reference(NEW.project_reference);
  v_old_reference := CASE
    WHEN TG_OP = 'UPDATE' THEN private.normalize_site_reference(OLD.project_reference)
    ELSE NULL
  END;

  IF v_old_reference IS NOT NULL AND v_old_reference IS DISTINCT FROM v_new_reference THEN
    PERFORM private.reconcile_project_number_site_location(v_old_reference, v_actor);
  END IF;

  IF v_new_reference IS NOT NULL THEN
    PERFORM private.reconcile_project_number_site_location(v_new_reference, v_actor);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_quotes_reconcile_site_location ON public.quotes;
CREATE CONSTRAINT TRIGGER trg_quotes_reconcile_site_location
AFTER INSERT OR UPDATE OF
  quote_reference,
  base_quote_reference,
  status,
  commercial_status,
  site_address,
  subject_line,
  is_latest_version,
  revision_number,
  updated_by
OR DELETE ON public.quotes
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION private.trg_reconcile_quote_site_location();

DROP TRIGGER IF EXISTS trg_quote_merge_members_reconcile_site_location ON public.quote_merge_members;
CREATE CONSTRAINT TRIGGER trg_quote_merge_members_reconcile_site_location
AFTER INSERT OR UPDATE OF base_quote_reference, is_survivor, quote_thread_id
OR DELETE ON public.quote_merge_members
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION private.trg_reconcile_quote_merge_site_location();

DROP TRIGGER IF EXISTS trg_quote_project_numbers_reconcile_site_location ON public.quote_project_numbers;
CREATE CONSTRAINT TRIGGER trg_quote_project_numbers_reconcile_site_location
AFTER INSERT OR UPDATE OF
  project_reference,
  status,
  title,
  description,
  converted_quote_id,
  updated_by
OR DELETE ON public.quote_project_numbers
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION private.trg_reconcile_project_number_site_location();

REVOKE ALL ON FUNCTION private.normalize_site_reference(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.quote_should_have_active_site(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.quote_should_archive_site(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.site_location_has_protected_stock(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.quote_site_location_label(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.build_site_location_name(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.is_retired_quote_reference(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.get_canonical_quote_for_reference(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.reconcile_quote_site_location(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.reconcile_project_number_site_location(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.trg_reconcile_quote_site_location() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.trg_reconcile_quote_merge_site_location() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.trg_reconcile_project_number_site_location() FROM PUBLIC;

-- Backfill canonical open quote sites and archive terminal quote-owned sites.
DO $$
DECLARE
  v_reference TEXT;
  v_missing INTEGER;
  v_duplicates INTEGER;
  v_target_active INTEGER;
BEGIN
  FOR v_reference IN
    SELECT DISTINCT private.normalize_site_reference(COALESCE(quote.base_quote_reference, quote.quote_reference))
    FROM public.quotes AS quote
    WHERE NULLIF(BTRIM(COALESCE(quote.base_quote_reference, quote.quote_reference)), '') IS NOT NULL
  LOOP
    PERFORM private.reconcile_quote_site_location(v_reference, NULL);
  END LOOP;

  SELECT COUNT(*)
  INTO v_missing
  FROM (
    SELECT DISTINCT ON (private.normalize_site_reference(COALESCE(base_quote_reference, quote_reference)))
      private.normalize_site_reference(COALESCE(base_quote_reference, quote_reference)) AS reference,
      status,
      commercial_status,
      quote_thread_id
    FROM public.quotes
    WHERE NULLIF(BTRIM(COALESCE(base_quote_reference, quote_reference)), '') IS NOT NULL
    ORDER BY
      private.normalize_site_reference(COALESCE(base_quote_reference, quote_reference)),
      is_latest_version DESC,
      revision_number DESC,
      created_at DESC,
      id DESC
  ) canonical
  WHERE private.quote_should_have_active_site(canonical.status, canonical.commercial_status)
    AND NOT private.is_retired_quote_reference(canonical.reference)
    AND NOT EXISTS (
      SELECT 1
      FROM public.inventory_locations loc
      WHERE loc.location_type = 'site'
        AND loc.is_active = TRUE
        AND private.normalize_site_reference(loc.external_reference) = canonical.reference
    );

  IF v_missing > 0 THEN
    RAISE EXCEPTION 'Backfill postcondition failed: % canonical open quotes still missing active sites.', v_missing;
  END IF;

  SELECT COUNT(*)
  INTO v_duplicates
  FROM (
    SELECT private.normalize_site_reference(external_reference) AS reference
    FROM public.inventory_locations
    WHERE location_type = 'site'
      AND is_active = TRUE
      AND external_reference IS NOT NULL
    GROUP BY private.normalize_site_reference(external_reference)
    HAVING COUNT(*) > 1
  ) duplicates;

  IF v_duplicates > 0 THEN
    RAISE EXCEPTION 'Backfill postcondition failed: % duplicate active site references remain.', v_duplicates;
  END IF;

  SELECT COUNT(*)
  INTO v_target_active
  FROM public.inventory_locations
  WHERE location_type = 'site'
    AND is_active = TRUE
    AND source_type = 'quote'
    AND private.normalize_site_reference(external_reference) = '40106-GH';

  IF v_target_active <> 1 THEN
    RAISE EXCEPTION 'Backfill postcondition failed: expected exactly one active quote site for 40106-GH, found %.', v_target_active;
  END IF;
END;
$$;

COMMIT;
