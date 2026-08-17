-- finalise-phase: predeploy
BEGIN;

ALTER TABLE public.reminder_actions
  ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS reminder_actions_open_due_at_idx
  ON public.reminder_actions (workflow_key, status, due_at)
  WHERE status = 'open' AND due_at IS NOT NULL;

CREATE OR REPLACE FUNCTION private.compact_catalog_job_code(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT NULLIF(UPPER(regexp_replace(COALESCE(p_value, ''), '[^0-9A-Za-z]', '', 'g')), '');
$$;

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
  v_row private.allocation_job;
  v_input_code TEXT := private.compact_catalog_job_code(p_job_code);
  v_source_code TEXT;
BEGIN
  IF p_source_type = 'legacy_quote' AND p_source_id IS NOT NULL THEN
    SELECT
      'legacy_quote'::TEXT,
      public.legacy_quotes.id,
      NULLIF(BTRIM(public.legacy_quotes.quote_reference), ''),
      NULLIF(BTRIM(public.legacy_quotes.site_address), ''),
      public.legacy_quotes.customer_name,
      public.legacy_quotes.title,
      private.allocation_site_is_valid(public.legacy_quotes.site_address)
    INTO v_row
    FROM public.legacy_quotes
    WHERE public.legacy_quotes.id = p_source_id;

    IF v_row.source_id IS NULL THEN
      IF p_require_valid THEN
        RAISE EXCEPTION 'JOB_NOT_FOUND';
      END IF;
      RETURN NULL;
    END IF;

    v_source_code := private.compact_catalog_job_code(v_row.job_code);
    IF v_source_code IS NULL THEN
      IF p_require_valid THEN
        RAISE EXCEPTION 'JOB_NOT_FOUND';
      END IF;
      RETURN NULL;
    END IF;

    IF v_input_code IS NOT NULL AND v_input_code IS DISTINCT FROM v_source_code THEN
      IF p_require_valid THEN
        RAISE EXCEPTION 'JOB_NOT_FOUND';
      END IF;
      RETURN NULL;
    END IF;

    RETURN v_row;
  END IF;

  RETURN private.apply_allocation_job_fields(
    p_source_type,
    p_source_id,
    p_job_code,
    p_require_valid
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.guard_plant_inspection_job_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job private.allocation_job;
BEGIN
  IF NEW.job_source_type IS NULL
    AND NEW.job_source_id IS NULL
    AND NULLIF(BTRIM(COALESCE(NEW.job_code, '')), '') IS NULL THEN
    NEW.job_site_address := NULL;
    IF NEW.status = 'submitted' THEN
      IF TG_OP = 'UPDATE'
        AND OLD.status = 'submitted'
        AND OLD.job_source_type IS NULL
        AND OLD.job_source_id IS NULL
        AND NULLIF(BTRIM(COALESCE(OLD.job_code, '')), '') IS NULL THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'JOB_REQUIRED';
    END IF;
    RETURN NEW;
  END IF;

  v_job := private.apply_plant_inspection_job_fields(
    NEW.job_source_type,
    NEW.job_source_id,
    NEW.job_code,
    NEW.status = 'submitted'
  );
  IF v_job IS NULL THEN
    NEW.job_source_type := NULL;
    NEW.job_source_id := NULL;
    NEW.job_code := NULL;
    NEW.job_site_address := NULL;
    RETURN NEW;
  END IF;

  NEW.job_source_type := v_job.source_type;
  NEW.job_source_id := v_job.source_id;
  NEW.job_code := v_job.job_code;
  NEW.job_site_address := v_job.site_address;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.upsert_plant_legacy_missing_site_action(
  p_inspection_id UUID,
  p_legacy_source_id UUID,
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
BEGIN
  IF p_legacy_source_id IS NULL OR v_job_code IS NULL OR v_compact IS NULL THEN
    RETURN;
  END IF;

  v_dedupe_key := 'plant_legacy_missing_site:' || p_legacy_source_id::TEXT || ':' || v_compact;

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
    'Add a site address for legacy job ' || v_job_code,
    'A plant daily check used this legacy job code. Add a valid site address within 48 hours.',
    jsonb_build_object(
      'job_code', v_job_code,
      'customer_name', p_customer_name,
      'quote_title', p_quote_title,
      'legacy_source_id', p_legacy_source_id,
      'inspection_id', p_inspection_id,
      'inspection_date', p_inspection_date,
      'submitted_by', p_submitted_by,
      'plant_id', p_plant_id
    ),
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
  v_legacy public.legacy_quotes%ROWTYPE;
BEGIN
  IF NEW.status IS DISTINCT FROM 'submitted' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'submitted' THEN
    RETURN NEW;
  END IF;

  IF NEW.job_source_type IS DISTINCT FROM 'legacy_quote' OR NEW.job_source_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF private.allocation_site_is_valid(NEW.job_site_address) THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO v_legacy
  FROM public.legacy_quotes
  WHERE public.legacy_quotes.id = NEW.job_source_id;

  IF v_legacy.id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM private.upsert_plant_legacy_missing_site_action(
    NEW.id,
    NEW.job_source_id,
    NEW.job_code,
    v_legacy.customer_name,
    v_legacy.title,
    NEW.inspection_date,
    NEW.user_id,
    NEW.plant_id,
    NOW()
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS plant_inspections_legacy_missing_site_action ON public.plant_inspections;
CREATE TRIGGER plant_inspections_legacy_missing_site_action
  AFTER INSERT OR UPDATE ON public.plant_inspections
  FOR EACH ROW
  EXECUTE FUNCTION private.ensure_plant_legacy_missing_site_action();

REVOKE ALL ON FUNCTION private.compact_catalog_job_code(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.apply_plant_inspection_job_fields(TEXT, UUID, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.upsert_plant_legacy_missing_site_action(UUID, UUID, TEXT, TEXT, TEXT, DATE, UUID, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.ensure_plant_legacy_missing_site_action() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.guard_plant_inspection_job_fields() FROM PUBLIC, anon, authenticated;

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
  'plant_legacy_missing_site:' || qualifying.job_source_id::TEXT || ':' || qualifying.compact_job_code,
  'open',
  'high',
  'Add a site address for legacy job ' || qualifying.job_code,
  'A plant daily check used this legacy job code. Add a valid site address within 48 hours.',
  jsonb_build_object(
    'job_code', qualifying.job_code,
    'customer_name', qualifying.customer_name,
    'quote_title', qualifying.quote_title,
    'legacy_source_id', qualifying.job_source_id,
    'inspection_id', qualifying.id,
    'inspection_date', qualifying.inspection_date,
    'submitted_by', qualifying.user_id,
    'plant_id', qualifying.plant_id
  ),
  qualifying.user_id,
  qualifying.detected_at,
  qualifying.detected_at,
  qualifying.detected_at + INTERVAL '48 hours'
FROM (
  SELECT DISTINCT ON (
    inspections.job_source_id,
    private.compact_catalog_job_code(inspections.job_code)
  )
    inspections.id,
    inspections.job_source_id,
    NULLIF(BTRIM(inspections.job_code), '') AS job_code,
    private.compact_catalog_job_code(inspections.job_code) AS compact_job_code,
    inspections.inspection_date,
    inspections.user_id,
    inspections.plant_id,
    COALESCE(inspections.submitted_at, inspections.created_at, NOW()) AS detected_at,
    legacy_quotes.customer_name,
    legacy_quotes.title AS quote_title
  FROM public.plant_inspections AS inspections
  JOIN public.legacy_quotes
    ON public.legacy_quotes.id = inspections.job_source_id
  WHERE inspections.status = 'submitted'
    AND inspections.job_source_type = 'legacy_quote'
    AND inspections.job_source_id IS NOT NULL
    AND NULLIF(BTRIM(COALESCE(inspections.job_code, '')), '') IS NOT NULL
    AND private.compact_catalog_job_code(inspections.job_code) IS NOT NULL
    AND NOT private.allocation_site_is_valid(inspections.job_site_address)
  ORDER BY
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
