-- Strict daily-allocation resolver used only by the plant inspection PGlite fixture.
CREATE OR REPLACE FUNCTION private.apply_allocation_job_fields(
  p_source_type TEXT,
  p_source_id UUID,
  p_job_code TEXT,
  p_require_valid BOOLEAN
)
RETURNS private.allocation_job
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INTEGER := 0;
  v_row private.allocation_job;
  v_lookup_code TEXT;
BEGIN
  SELECT COUNT(*)
  INTO v_count
  FROM private.resolve_allocation_job(p_source_type, p_source_id, p_job_code);

  IF v_count = 0 THEN
    IF p_require_valid THEN
      RAISE EXCEPTION 'JOB_NOT_FOUND';
    END IF;
    RETURN NULL;
  END IF;

  IF v_count > 1 THEN
    RAISE EXCEPTION 'JOB_AMBIGUOUS';
  END IF;

  SELECT
    resolved.source_type,
    resolved.source_id,
    resolved.job_code,
    resolved.site_address,
    resolved.customer_name,
    resolved.title,
    resolved.address_valid
  INTO v_row
  FROM private.resolve_allocation_job(p_source_type, p_source_id, p_job_code) AS resolved;

  FOR v_lookup_code IN
    SELECT v_row.job_code
    UNION
    SELECT aliases.alias_reference::TEXT
    FROM public.quotes
    JOIN public.quote_reference_aliases aliases
      ON aliases.canonical_quote_thread_id = quotes.quote_thread_id
    WHERE v_row.source_type = 'live_quote'
      AND quotes.id = v_row.source_id
    UNION
    SELECT projects.project_reference::TEXT
    FROM public.quote_project_numbers projects
    WHERE (
      v_row.source_type = 'live_quote'
      AND projects.status = 'converted'
      AND projects.converted_quote_id = v_row.source_id
    )
    OR (
      v_row.source_type = 'project_number'
      AND projects.status = 'merged'
      AND projects.merged_into_project_number_id = v_row.source_id
    )
  LOOP
    SELECT COUNT(*)
    INTO v_count
    FROM private.resolve_allocation_job(NULL, NULL, v_lookup_code);

    IF v_count > 1 THEN
      RAISE EXCEPTION 'JOB_AMBIGUOUS';
    END IF;
  END LOOP;

  IF p_require_valid AND NOT v_row.address_valid THEN
    RAISE EXCEPTION 'JOB_MISSING_SITE';
  END IF;

  RETURN v_row;
END;
$$;
