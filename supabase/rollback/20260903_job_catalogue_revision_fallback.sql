-- Recovery script for 20260903_job_catalogue_revision_fallback.sql.
-- Restores prior private.resolve_allocation_job behaviour and drops the
-- thread-representative helper. An applied production reversal must be a new
-- dated forward corrective migration; do not delete ledger evidence or treat
-- this file as a generic migrate target.
BEGIN;

DROP FUNCTION IF EXISTS private.allocation_live_quote_thread_representative(UUID);

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
  v_quote_id UUID := p_source_id;
  v_canonical_thread UUID;
BEGIN
  IF p_source_type = 'live_quote' AND p_source_id IS NOT NULL THEN
    SELECT aliases.canonical_quote_thread_id
    INTO v_canonical_thread
    FROM public.quotes
    JOIN public.quote_reference_aliases aliases
      ON aliases.source_quote_thread_id = quotes.quote_thread_id
    WHERE quotes.id = p_source_id
    LIMIT 1;

    IF v_canonical_thread IS NOT NULL THEN
      SELECT quotes.id
      INTO v_quote_id
      FROM public.quotes
      JOIN public.customers ON customers.id = quotes.customer_id
      WHERE quotes.quote_thread_id = v_canonical_thread
        AND private.allocation_quote_is_catalogue_eligible(
          quotes.is_latest_version,
          quotes.commercial_status,
          quotes.status,
          customers.status
        )
      LIMIT 1;
    END IF;

    RETURN QUERY
    SELECT
      'live_quote'::TEXT,
      quotes.id,
      COALESCE(NULLIF(BTRIM(quotes.base_quote_reference), ''), NULLIF(BTRIM(quotes.quote_reference), ''))::TEXT,
      NULLIF(BTRIM(quotes.site_address), '')::TEXT,
      customers.company_name::TEXT,
      COALESCE(NULLIF(BTRIM(quotes.subject_line), ''), NULLIF(BTRIM(quotes.project_description), ''))::TEXT,
      private.allocation_site_is_valid(quotes.site_address)
    FROM public.quotes
    JOIN public.customers ON customers.id = quotes.customer_id
    WHERE quotes.id = COALESCE(v_quote_id, p_source_id)
      AND private.allocation_quote_is_catalogue_eligible(
        quotes.is_latest_version,
        quotes.commercial_status,
        quotes.status,
        customers.status
      )
    LIMIT 1;
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
        quotes.id AS source_id,
        COALESCE(NULLIF(BTRIM(quotes.base_quote_reference), ''), NULLIF(BTRIM(quotes.quote_reference), ''))::TEXT AS job_code,
        NULLIF(BTRIM(quotes.site_address), '')::TEXT AS site_address,
        customers.company_name::TEXT AS customer_name,
        COALESCE(NULLIF(BTRIM(quotes.subject_line), ''), NULLIF(BTRIM(quotes.project_description), ''))::TEXT AS title,
        private.allocation_site_is_valid(quotes.site_address) AS address_valid
      FROM public.quotes
      JOIN public.customers ON customers.id = quotes.customer_id
      WHERE private.allocation_quote_is_catalogue_eligible(
          quotes.is_latest_version,
          quotes.commercial_status,
          quotes.status,
          customers.status
        )
        AND UPPER(COALESCE(quotes.base_quote_reference, quotes.quote_reference, '')) = v_code
        AND NOT EXISTS (
          SELECT 1
          FROM public.quote_reference_aliases aliases
          WHERE aliases.source_quote_thread_id = quotes.quote_thread_id
        )
      UNION ALL
      SELECT
        'live_quote',
        quotes.id,
        COALESCE(NULLIF(BTRIM(quotes.base_quote_reference), ''), NULLIF(BTRIM(quotes.quote_reference), '')),
        NULLIF(BTRIM(quotes.site_address), ''),
        customers.company_name,
        COALESCE(NULLIF(BTRIM(quotes.subject_line), ''), NULLIF(BTRIM(quotes.project_description), '')),
        private.allocation_site_is_valid(quotes.site_address)
      FROM public.quote_reference_aliases aliases
      JOIN public.quotes ON quotes.quote_thread_id = aliases.canonical_quote_thread_id
      JOIN public.customers ON customers.id = quotes.customer_id
      WHERE private.allocation_quote_is_catalogue_eligible(
          quotes.is_latest_version,
          quotes.commercial_status,
          quotes.status,
          customers.status
        )
        AND UPPER(BTRIM(aliases.alias_reference)) = v_code
      UNION ALL
      SELECT
        'live_quote',
        quotes.id,
        COALESCE(NULLIF(BTRIM(quotes.base_quote_reference), ''), NULLIF(BTRIM(quotes.quote_reference), '')),
        NULLIF(BTRIM(quotes.site_address), ''),
        customers.company_name,
        COALESCE(NULLIF(BTRIM(quotes.subject_line), ''), NULLIF(BTRIM(quotes.project_description), '')),
        private.allocation_site_is_valid(quotes.site_address)
      FROM public.quote_project_numbers converted
      JOIN public.quotes ON quotes.id = converted.converted_quote_id
      JOIN public.customers ON customers.id = quotes.customer_id
      WHERE converted.status = 'converted'
        AND private.allocation_quote_is_catalogue_eligible(
          quotes.is_latest_version,
          quotes.commercial_status,
          quotes.status,
          customers.status
        )
        AND UPPER(BTRIM(converted.project_reference)) = v_code
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

COMMIT;
