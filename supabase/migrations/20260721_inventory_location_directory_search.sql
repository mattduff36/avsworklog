BEGIN;

CREATE INDEX IF NOT EXISTS inventory_locations_active_directory_idx
  ON public.inventory_locations (name, id)
  WHERE is_active = TRUE;

DROP FUNCTION IF EXISTS public.inventory_search_locations(TEXT, BOOLEAN, INTEGER, INTEGER);

CREATE FUNCTION public.inventory_search_locations(
  p_search TEXT DEFAULT '',
  p_include_legacy BOOLEAN DEFAULT FALSE,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  description TEXT,
  is_active BOOLEAN,
  linked_van_id UUID,
  linked_hgv_id UUID,
  linked_plant_id UUID,
  location_type TEXT,
  source_type TEXT,
  source_id UUID,
  external_reference TEXT,
  sync_status TEXT,
  source_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  created_by UUID,
  updated_by UUID,
  total_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_search TEXT := BTRIM(COALESCE(p_search, ''));
  v_pattern TEXT;
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_offset INTEGER := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  v_pattern := '%' || REPLACE(
    REPLACE(
      REPLACE(v_search, E'\\', E'\\\\'),
      '%',
      E'\\%'
    ),
    '_',
    E'\\_'
  ) || '%';

  RETURN QUERY
  SELECT
    il.id,
    il.name,
    il.description,
    il.is_active,
    il.linked_van_id,
    il.linked_hgv_id,
    il.linked_plant_id,
    il.location_type,
    il.source_type,
    il.source_id,
    il.external_reference,
    il.sync_status,
    il.source_synced_at,
    il.created_at,
    il.updated_at,
    il.created_by,
    il.updated_by,
    COUNT(*) OVER() AS total_count
  FROM public.inventory_locations AS il
  LEFT JOIN public.vans AS v
    ON v.id = il.linked_van_id
  LEFT JOIN public.hgvs AS h
    ON h.id = il.linked_hgv_id
  LEFT JOIN public.plant AS p
    ON p.id = il.linked_plant_id
  WHERE il.is_active = TRUE
    AND (
      p_include_legacy
      OR il.source_type IS DISTINCT FROM 'legacy_quote'
    )
    AND (
      v_search = ''
      OR il.name ILIKE v_pattern ESCAPE E'\\'
      OR il.location_type ILIKE v_pattern ESCAPE E'\\'
      OR (
        CASE il.location_type
          WHEN 'yard' THEN 'Yard'
          WHEN 'unknown' THEN 'Unknown'
          WHEN 'van' THEN 'Van'
          WHEN 'hgv' THEN 'HGV'
          WHEN 'plant' THEN 'Plant'
          WHEN 'site' THEN 'Site'
          ELSE 'Manual'
        END
      ) ILIKE v_pattern ESCAPE E'\\'
      OR il.external_reference ILIKE v_pattern ESCAPE E'\\'
      OR v.reg_number ILIKE v_pattern ESCAPE E'\\'
      OR v.nickname ILIKE v_pattern ESCAPE E'\\'
      OR h.reg_number ILIKE v_pattern ESCAPE E'\\'
      OR h.nickname ILIKE v_pattern ESCAPE E'\\'
      OR p.reg_number ILIKE v_pattern ESCAPE E'\\'
      OR p.plant_id ILIKE v_pattern ESCAPE E'\\'
      OR p.nickname ILIKE v_pattern ESCAPE E'\\'
    )
  ORDER BY il.name ASC, il.id ASC
  LIMIT v_limit
  OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.inventory_search_locations(TEXT, BOOLEAN, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_search_locations(TEXT, BOOLEAN, INTEGER, INTEGER)
  TO service_role;

COMMENT ON FUNCTION public.inventory_search_locations(TEXT, BOOLEAN, INTEGER, INTEGER) IS
  'Returns a deterministic page of active Inventory locations with multi-field search and total count.';

COMMIT;
