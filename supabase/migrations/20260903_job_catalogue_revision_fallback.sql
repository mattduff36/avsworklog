-- finalise-phase: predeploy
-- Thread-representative live-quote catalogue identity for timesheets,
-- plant inspections, and daily allocation job resolution.
-- Do not edit 20260813_daily_allocation_module.sql.
BEGIN;

CREATE OR REPLACE FUNCTION private.allocation_live_quote_thread_representative(
  p_thread_id UUID
)
RETURNS TABLE (
  source_id UUID,
  job_code TEXT,
  site_address TEXT,
  customer_name TEXT,
  title TEXT,
  address_valid BOOLEAN
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH thread_quotes AS (
    SELECT
      quotes.id,
      quotes.quote_thread_id,
      quotes.is_latest_version,
      quotes.revision_number,
      quotes.created_at,
      quotes.status,
      quotes.commercial_status,
      quotes.base_quote_reference,
      quotes.quote_reference,
      quotes.site_address,
      quotes.subject_line,
      quotes.project_description,
      customers.status AS customer_status,
      customers.company_name
    FROM public.quotes
    JOIN public.customers ON customers.id = quotes.customer_id
    WHERE p_thread_id IS NOT NULL
      AND quotes.quote_thread_id = p_thread_id
  ),
  latest AS (
    SELECT *
    FROM thread_quotes
    WHERE COALESCE(is_latest_version, FALSE)
    ORDER BY revision_number DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    LIMIT 1
  ),
  latest_open_active AS (
    SELECT *
    FROM latest
    WHERE commercial_status = 'open'
      AND customer_status = 'active'
  ),
  candidates AS (
    SELECT
      latest_open_active.*,
      0 AS pick_rank
    FROM latest_open_active
    WHERE status = ANY (ARRAY[
      'sent',
      'won',
      'ready_to_invoice',
      'po_received',
      'in_progress',
      'completed_part',
      'completed_full',
      'partially_invoiced',
      'invoiced'
    ])
    UNION ALL
    SELECT
      fallback.*,
      1 AS pick_rank
    FROM latest_open_active
    JOIN thread_quotes AS fallback ON TRUE
    WHERE latest_open_active.status = ANY (ARRAY[
      'draft',
      'pending_internal_approval',
      'approved',
      'changes_requested'
    ])
      AND NOT COALESCE(fallback.is_latest_version, FALSE)
      AND fallback.commercial_status = 'open'
      AND fallback.customer_status = 'active'
      AND fallback.status = ANY (ARRAY[
        'sent',
        'won',
        'ready_to_invoice',
        'po_received',
        'in_progress',
        'completed_part',
        'completed_full',
        'partially_invoiced',
        'invoiced'
      ])
  ),
  chosen AS (
    SELECT *
    FROM candidates
    ORDER BY pick_rank ASC, revision_number DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    LIMIT 1
  )
  SELECT
    chosen.id,
    COALESCE(NULLIF(BTRIM(chosen.base_quote_reference), ''), NULLIF(BTRIM(chosen.quote_reference), ''))::TEXT,
    NULLIF(BTRIM(chosen.site_address), '')::TEXT,
    chosen.company_name::TEXT,
    COALESCE(NULLIF(BTRIM(chosen.subject_line), ''), NULLIF(BTRIM(chosen.project_description), ''))::TEXT,
    private.allocation_site_is_valid(chosen.site_address)
  FROM chosen;
$$;

CREATE OR REPLACE FUNCTION private.resolve_allocation_job(
  p_source_type TEXT,
  p_source_id UUID,
  p_job_code TEXT
)
RETURNS TABLE (
  source_type TEXT,
  source_id UUID,
  job_code TEXT,
  site_address TEXT,
  customer_name TEXT,
  title TEXT,
  address_valid BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code TEXT := NULLIF(UPPER(BTRIM(p_job_code)), '');
  v_project_status TEXT;
  v_merged_into UUID;
  v_converted_quote_id UUID;
  v_quote_thread UUID;
  v_canonical_thread UUID;
  v_resolve_thread UUID;
BEGIN
  IF p_source_type = 'live_quote' AND p_source_id IS NOT NULL THEN
    SELECT quotes.quote_thread_id
    INTO v_quote_thread
    FROM public.quotes
    WHERE quotes.id = p_source_id;

    SELECT aliases.canonical_quote_thread_id
    INTO v_canonical_thread
    FROM public.quote_reference_aliases aliases
    WHERE aliases.source_quote_thread_id = v_quote_thread
    LIMIT 1;

    v_resolve_thread := COALESCE(v_canonical_thread, v_quote_thread);

    RETURN QUERY
    SELECT
      'live_quote'::TEXT,
      rep.source_id,
      rep.job_code,
      rep.site_address,
      rep.customer_name,
      rep.title,
      rep.address_valid
    FROM private.allocation_live_quote_thread_representative(v_resolve_thread) AS rep;
    RETURN;
  END IF;

  IF p_source_type = 'project_number' AND p_source_id IS NOT NULL THEN
    SELECT
      quote_project_numbers.status,
      quote_project_numbers.merged_into_project_number_id,
      quote_project_numbers.converted_quote_id
    INTO v_project_status, v_merged_into, v_converted_quote_id
    FROM public.quote_project_numbers
    WHERE quote_project_numbers.id = p_source_id;

    IF v_project_status = 'merged' AND v_merged_into IS NOT NULL AND v_merged_into IS DISTINCT FROM p_source_id THEN
      RETURN QUERY
      SELECT * FROM private.resolve_allocation_job('project_number', v_merged_into, NULL);
      RETURN;
    END IF;

    IF v_project_status = 'converted' AND v_converted_quote_id IS NOT NULL THEN
      RETURN QUERY
      SELECT * FROM private.resolve_allocation_job('live_quote', v_converted_quote_id, NULL);
      RETURN;
    END IF;

    RETURN QUERY
    SELECT
      'project_number'::TEXT,
      quote_project_numbers.id,
      quote_project_numbers.project_reference::TEXT,
      NULLIF(BTRIM(quote_project_numbers.site_address), '')::TEXT,
      'Project number'::TEXT,
      COALESCE(NULLIF(BTRIM(quote_project_numbers.title), ''), NULLIF(BTRIM(quote_project_numbers.description), ''))::TEXT,
      private.allocation_site_is_valid(quote_project_numbers.site_address)
    FROM public.quote_project_numbers
    WHERE quote_project_numbers.id = p_source_id
      AND quote_project_numbers.status = 'open'
    LIMIT 1;
    RETURN;
  END IF;

  IF p_source_type = 'legacy_quote' AND p_source_id IS NOT NULL THEN
    RETURN QUERY
    SELECT
      'legacy_quote'::TEXT,
      legacy_quotes.id,
      legacy_quotes.quote_reference::TEXT,
      NULLIF(BTRIM(legacy_quotes.site_address), '')::TEXT,
      legacy_quotes.customer_name::TEXT,
      legacy_quotes.title::TEXT,
      private.allocation_site_is_valid(legacy_quotes.site_address)
    FROM public.legacy_quotes
    WHERE legacy_quotes.id = p_source_id
    LIMIT 1;
    RETURN;
  END IF;

  IF v_code IS NOT NULL THEN
    RETURN QUERY
    WITH candidate_threads AS (
      SELECT DISTINCT quotes.quote_thread_id AS thread_id
      FROM public.quotes
      WHERE UPPER(COALESCE(quotes.base_quote_reference, quotes.quote_reference, '')) = v_code
        AND NOT EXISTS (
          SELECT 1
          FROM public.quote_reference_aliases aliases
          WHERE aliases.source_quote_thread_id = quotes.quote_thread_id
        )
      UNION
      SELECT DISTINCT aliases.canonical_quote_thread_id
      FROM public.quote_reference_aliases aliases
      WHERE UPPER(BTRIM(aliases.alias_reference)) = v_code
      UNION
      SELECT DISTINCT COALESCE(retired.canonical_quote_thread_id, quotes.quote_thread_id)
      FROM public.quote_project_numbers converted
      JOIN public.quotes ON quotes.id = converted.converted_quote_id
      LEFT JOIN public.quote_reference_aliases retired
        ON retired.source_quote_thread_id = quotes.quote_thread_id
      WHERE converted.status = 'converted'
        AND UPPER(BTRIM(converted.project_reference)) = v_code
    )
    SELECT DISTINCT ON (resolved.source_type, resolved.source_id)
      resolved.source_type,
      resolved.source_id,
      resolved.job_code,
      resolved.site_address,
      resolved.customer_name,
      resolved.title,
      resolved.address_valid
    FROM (
      SELECT
        'live_quote'::TEXT AS source_type,
        rep.source_id,
        rep.job_code,
        rep.site_address,
        rep.customer_name,
        rep.title,
        rep.address_valid
      FROM candidate_threads
      JOIN LATERAL private.allocation_live_quote_thread_representative(candidate_threads.thread_id) AS rep ON TRUE
      UNION ALL
      SELECT
        'project_number',
        quote_project_numbers.id,
        quote_project_numbers.project_reference,
        NULLIF(BTRIM(quote_project_numbers.site_address), ''),
        'Project number',
        COALESCE(NULLIF(BTRIM(quote_project_numbers.title), ''), NULLIF(BTRIM(quote_project_numbers.description), '')),
        private.allocation_site_is_valid(quote_project_numbers.site_address)
      FROM public.quote_project_numbers
      WHERE quote_project_numbers.status = 'open'
        AND UPPER(quote_project_numbers.project_reference) = v_code
      UNION ALL
      SELECT
        'project_number',
        survivor.id,
        survivor.project_reference,
        NULLIF(BTRIM(survivor.site_address), ''),
        'Project number',
        COALESCE(NULLIF(BTRIM(survivor.title), ''), NULLIF(BTRIM(survivor.description), '')),
        private.allocation_site_is_valid(survivor.site_address)
      FROM public.quote_project_numbers merged
      JOIN public.quote_project_numbers survivor
        ON survivor.id = merged.merged_into_project_number_id
      WHERE merged.status = 'merged'
        AND survivor.status = 'open'
        AND UPPER(BTRIM(merged.project_reference)) = v_code
      UNION ALL
      SELECT
        'legacy_quote',
        legacy_quotes.id,
        legacy_quotes.quote_reference,
        NULLIF(BTRIM(legacy_quotes.site_address), ''),
        legacy_quotes.customer_name,
        legacy_quotes.title,
        private.allocation_site_is_valid(legacy_quotes.site_address)
      FROM public.legacy_quotes
      WHERE UPPER(COALESCE(legacy_quotes.quote_reference, '')) = v_code
    ) AS resolved
    ORDER BY resolved.source_type, resolved.source_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.allocation_live_quote_thread_representative(UUID) FROM PUBLIC, anon, authenticated;

COMMIT;
