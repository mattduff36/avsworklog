-- finalise-phase: predeploy
-- Plant Daily Checks accept an exact active catalogue identity even when the
-- site address is weak or the code also exists on another source.
-- Daily allocation continues to use private.apply_allocation_job_fields.
BEGIN;

CREATE OR REPLACE FUNCTION private.apply_plant_inspection_job_fields(
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
  v_input_code TEXT := private.compact_catalog_job_code(p_job_code);
  v_source_code TEXT;
BEGIN
  IF p_source_id IS NULL
    OR p_source_type IS NULL
    OR p_source_type NOT IN ('live_quote', 'legacy_quote', 'project_number') THEN
    IF p_require_valid THEN
      RAISE EXCEPTION 'JOB_NOT_FOUND';
    END IF;
    RETURN NULL;
  END IF;

  SELECT COUNT(*)
  INTO v_count
  FROM private.resolve_allocation_job(p_source_type, p_source_id, NULL);

  IF v_count <> 1 THEN
    IF p_require_valid THEN
      RAISE EXCEPTION 'JOB_NOT_FOUND';
    END IF;
    RETURN NULL;
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
  FROM private.resolve_allocation_job(p_source_type, p_source_id, NULL) AS resolved;

  IF v_row.source_type IS DISTINCT FROM p_source_type
    OR v_row.source_id IS DISTINCT FROM p_source_id THEN
    IF p_require_valid THEN
      RAISE EXCEPTION 'JOB_NOT_FOUND';
    END IF;
    RETURN NULL;
  END IF;

  v_source_code := private.compact_catalog_job_code(v_row.job_code);
  IF v_source_code IS NULL
    OR (p_require_valid AND v_input_code IS NULL)
    OR (v_input_code IS NOT NULL AND v_input_code IS DISTINCT FROM v_source_code) THEN
    IF p_require_valid THEN
      RAISE EXCEPTION 'JOB_NOT_FOUND';
    END IF;
    RETURN NULL;
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION private.upsert_plant_missing_site_action(
  p_inspection_id UUID,
  p_source_type TEXT,
  p_source_id UUID,
  p_job_code TEXT,
  p_customer_name TEXT,
  p_quote_title TEXT,
  p_inspection_date DATE,
  p_submitted_by UUID,
  p_plant_id UUID,
  p_detected_at TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job_code TEXT := NULLIF(BTRIM(p_job_code), '');
  v_compact TEXT := private.compact_catalog_job_code(p_job_code);
  v_dedupe_key TEXT;
  v_detected_at TIMESTAMPTZ := COALESCE(p_detected_at, NOW());
  v_title TEXT;
  v_description TEXT;
BEGIN
  IF p_source_id IS NULL
    OR v_job_code IS NULL
    OR v_compact IS NULL
    OR p_source_type NOT IN ('live_quote', 'legacy_quote', 'project_number') THEN
    RETURN;
  END IF;

  IF p_source_type = 'legacy_quote' THEN
    v_dedupe_key := 'plant_legacy_missing_site:' || p_source_id::TEXT || ':' || v_compact;
    v_title := 'Add a site address for legacy job ' || v_job_code;
    v_description := 'A plant daily check used this legacy job code. Add a valid site address within 48 hours.';
  ELSE
    v_dedupe_key := 'plant_legacy_missing_site:' || p_source_type || ':' || p_source_id::TEXT || ':' || v_compact;
    v_title := 'Add a site address for job ' || v_job_code;
    v_description := 'A plant daily check used this job code. Add a valid site address within 48 hours.';
  END IF;

  INSERT INTO public.reminder_actions (
    workflow_key,
    source_type,
    dedupe_key,
    status,
    priority,
    title,
    description,
    metadata,
    created_by,
    first_detected_at,
    last_detected_at,
    due_at
  )
  VALUES (
    'plant_legacy_missing_site',
    'system_generated',
    v_dedupe_key,
    'open',
    'high',
    v_title,
    v_description,
    jsonb_strip_nulls(jsonb_build_object(
      'job_code', v_job_code,
      'customer_name', p_customer_name,
      'quote_title', p_quote_title,
      'job_source_type', p_source_type,
      'job_source_id', p_source_id,
      'legacy_source_id', CASE WHEN p_source_type = 'legacy_quote' THEN p_source_id ELSE NULL END,
      'inspection_id', p_inspection_id,
      'inspection_date', p_inspection_date,
      'submitted_by', p_submitted_by,
      'plant_id', p_plant_id
    )),
    p_submitted_by,
    v_detected_at,
    v_detected_at,
    v_detected_at + INTERVAL '48 hours'
  )
  ON CONFLICT (dedupe_key) WHERE status = 'open' DO UPDATE
  SET
    last_detected_at = EXCLUDED.last_detected_at,
    metadata = EXCLUDED.metadata,
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    updated_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION private.ensure_plant_legacy_missing_site_action()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer_name TEXT;
  v_quote_title TEXT;
BEGIN
  IF NEW.status IS DISTINCT FROM 'submitted' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'submitted' THEN
    RETURN NEW;
  END IF;

  IF NEW.job_source_id IS NULL
    OR NEW.job_source_type NOT IN ('live_quote', 'legacy_quote', 'project_number') THEN
    RETURN NEW;
  END IF;

  IF private.allocation_site_is_valid(NEW.job_site_address) THEN
    RETURN NEW;
  END IF;

  SELECT resolved.customer_name, resolved.title
  INTO v_customer_name, v_quote_title
  FROM private.resolve_allocation_job(NEW.job_source_type, NEW.job_source_id, NULL) AS resolved
  WHERE resolved.source_type = NEW.job_source_type
    AND resolved.source_id = NEW.job_source_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  PERFORM private.upsert_plant_missing_site_action(
    NEW.id,
    NEW.job_source_type,
    NEW.job_source_id,
    NEW.job_code,
    v_customer_name,
    v_quote_title,
    NEW.inspection_date,
    NEW.user_id,
    NEW.plant_id,
    NOW()
  );

  RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS private.upsert_plant_legacy_missing_site_action(UUID, UUID, TEXT, TEXT, TEXT, DATE, UUID, UUID, TIMESTAMPTZ);

DROP TRIGGER IF EXISTS plant_inspections_legacy_missing_site_action ON public.plant_inspections;
CREATE TRIGGER plant_inspections_legacy_missing_site_action
  AFTER INSERT OR UPDATE ON public.plant_inspections
  FOR EACH ROW
  EXECUTE FUNCTION private.ensure_plant_legacy_missing_site_action();

REVOKE ALL ON FUNCTION private.apply_plant_inspection_job_fields(TEXT, UUID, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.upsert_plant_missing_site_action(UUID, TEXT, UUID, TEXT, TEXT, TEXT, DATE, UUID, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.ensure_plant_legacy_missing_site_action() FROM PUBLIC, anon, authenticated;

INSERT INTO public.reminder_actions (
  workflow_key,
  source_type,
  dedupe_key,
  status,
  priority,
  title,
  description,
  metadata,
  created_by,
  first_detected_at,
  last_detected_at,
  due_at
)
SELECT
  'plant_legacy_missing_site',
  'system_generated',
  'plant_legacy_missing_site:' || qualifying.job_source_type || ':' || qualifying.job_source_id::TEXT || ':' || qualifying.compact_job_code,
  'open',
  'high',
  'Add a site address for job ' || qualifying.job_code,
  'A plant daily check used this job code. Add a valid site address within 48 hours.',
  jsonb_strip_nulls(jsonb_build_object(
    'job_code', qualifying.job_code,
    'customer_name', qualifying.customer_name,
    'quote_title', qualifying.quote_title,
    'job_source_type', qualifying.job_source_type,
    'job_source_id', qualifying.job_source_id,
    'inspection_id', qualifying.id,
    'inspection_date', qualifying.inspection_date,
    'submitted_by', qualifying.user_id,
    'plant_id', qualifying.plant_id
  )),
  qualifying.user_id,
  qualifying.detected_at,
  qualifying.detected_at,
  qualifying.detected_at + INTERVAL '48 hours'
FROM (
  SELECT DISTINCT ON (
    inspections.job_source_type,
    inspections.job_source_id,
    private.compact_catalog_job_code(inspections.job_code)
  )
    inspections.id,
    inspections.job_source_type,
    inspections.job_source_id,
    NULLIF(BTRIM(inspections.job_code), '') AS job_code,
    private.compact_catalog_job_code(inspections.job_code) AS compact_job_code,
    inspections.inspection_date,
    inspections.user_id,
    inspections.plant_id,
    COALESCE(inspections.submitted_at, inspections.created_at, NOW()) AS detected_at,
    CASE
      WHEN inspections.job_source_type = 'project_number' THEN 'Project number'
      ELSE customers.company_name
    END AS customer_name,
    CASE
      WHEN inspections.job_source_type = 'live_quote' THEN COALESCE(
        NULLIF(BTRIM(quotes.subject_line), ''),
        NULLIF(BTRIM(quotes.project_description), '')
      )
      ELSE COALESCE(
        NULLIF(BTRIM(projects.title), ''),
        NULLIF(BTRIM(projects.description), '')
      )
    END AS quote_title
  FROM public.plant_inspections AS inspections
  LEFT JOIN public.quotes
    ON inspections.job_source_type = 'live_quote'
    AND public.quotes.id = inspections.job_source_id
  LEFT JOIN public.customers
    ON public.customers.id = public.quotes.customer_id
  LEFT JOIN public.quote_project_numbers AS projects
    ON inspections.job_source_type = 'project_number'
    AND projects.id = inspections.job_source_id
  WHERE inspections.status = 'submitted'
    AND inspections.job_source_type IN ('live_quote', 'project_number')
    AND inspections.job_source_id IS NOT NULL
    AND NULLIF(BTRIM(COALESCE(inspections.job_code, '')), '') IS NOT NULL
    AND private.compact_catalog_job_code(inspections.job_code) IS NOT NULL
    AND NOT private.allocation_site_is_valid(inspections.job_site_address)
    AND (
      (inspections.job_source_type = 'live_quote' AND quotes.id IS NOT NULL)
      OR (inspections.job_source_type = 'project_number' AND projects.id IS NOT NULL)
    )
  ORDER BY
    inspections.job_source_type,
    inspections.job_source_id,
    private.compact_catalog_job_code(inspections.job_code),
    COALESCE(inspections.submitted_at, inspections.created_at, NOW()) DESC,
    inspections.id DESC
) AS qualifying
ON CONFLICT (dedupe_key) WHERE status = 'open' DO UPDATE
SET
  last_detected_at = GREATEST(public.reminder_actions.last_detected_at, EXCLUDED.last_detected_at),
  metadata = EXCLUDED.metadata,
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  updated_at = NOW();

COMMIT;
