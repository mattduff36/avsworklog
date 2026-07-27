BEGIN;

ALTER TABLE public.quote_project_numbers
  ADD COLUMN IF NOT EXISTS merged_into_project_number_id UUID
    REFERENCES public.quote_project_numbers(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS merged_at TIMESTAMPTZ;

ALTER TABLE public.quote_project_numbers
  DROP CONSTRAINT IF EXISTS quote_project_numbers_status_check,
  ADD CONSTRAINT quote_project_numbers_status_check
    CHECK (status IN ('open', 'linked', 'converted', 'cancelled', 'merged'));

ALTER TABLE public.quote_project_numbers
  DROP CONSTRAINT IF EXISTS quote_project_numbers_merge_state_check,
  ADD CONSTRAINT quote_project_numbers_merge_state_check CHECK (
    (
      status = 'merged'
      AND merged_into_project_number_id IS NOT NULL
      AND merged_at IS NOT NULL
      AND converted_quote_id IS NOT NULL
      AND merged_into_project_number_id <> id
    )
    OR (
      status <> 'merged'
      AND merged_into_project_number_id IS NULL
      AND merged_at IS NULL
    )
  );

CREATE INDEX IF NOT EXISTS idx_quote_project_numbers_merged_into
  ON public.quote_project_numbers(merged_into_project_number_id)
  WHERE merged_into_project_number_id IS NOT NULL;

COMMENT ON COLUMN public.quote_project_numbers.merged_into_project_number_id IS
  'Permanent canonical project-number target when this project reference has been merged.';
COMMENT ON COLUMN public.quote_project_numbers.merged_at IS
  'Timestamp when this project number became an alias of another project number.';

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

DROP TRIGGER IF EXISTS canonicalise_merged_project_job_number_child
  ON public.timesheet_entry_job_codes;
DROP TRIGGER IF EXISTS canonicalise_merged_project_job_number_scalar
  ON public.timesheet_entries;
DROP FUNCTION IF EXISTS private.canonicalise_merged_project_job_number();

CREATE OR REPLACE FUNCTION private.resolve_merged_project_reference(p_reference TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_canonical_reference TEXT;
BEGIN
  IF p_reference IS NULL OR BTRIM(p_reference) = '' THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.quote_project_numbers
    WHERE project_reference = UPPER(BTRIM(p_reference))
  ) THEN
    RETURN NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('quote-project-number-alias-write', 0)
  );

  SELECT CASE
    WHEN alias.status = 'merged' THEN canonical.project_reference
    ELSE NULL
  END
  INTO v_canonical_reference
  FROM public.quote_project_numbers AS alias
  LEFT JOIN public.quote_project_numbers AS canonical
    ON canonical.id = alias.merged_into_project_number_id
  WHERE alias.project_reference = UPPER(BTRIM(p_reference))
  LIMIT 1;

  RETURN v_canonical_reference;
END;
$$;

CREATE OR REPLACE FUNCTION private.canonicalise_merged_project_job_number_child()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_canonical_reference TEXT;
BEGIN
  v_canonical_reference := private.resolve_merged_project_reference(NEW.job_number);
  IF v_canonical_reference IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND EXISTS (
    SELECT 1
    FROM public.timesheet_entry_job_codes AS existing
    WHERE existing.timesheet_entry_id = NEW.timesheet_entry_id
      AND existing.job_number = v_canonical_reference
  ) THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE' AND EXISTS (
    SELECT 1
    FROM public.timesheet_entry_job_codes AS existing
    WHERE existing.timesheet_entry_id = NEW.timesheet_entry_id
      AND existing.job_number = v_canonical_reference
      AND existing.id <> NEW.id
  ) THEN
    RETURN OLD;
  END IF;

  NEW.job_number := v_canonical_reference;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.canonicalise_merged_project_job_number_scalar()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_canonical_reference TEXT;
BEGIN
  v_canonical_reference := private.resolve_merged_project_reference(NEW.job_number);
  IF v_canonical_reference IS NOT NULL THEN
    NEW.job_number := v_canonical_reference;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.resolve_merged_project_reference(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.canonicalise_merged_project_job_number_child() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.canonicalise_merged_project_job_number_scalar() FROM PUBLIC;

CREATE TRIGGER canonicalise_merged_project_job_number_child
BEFORE INSERT OR UPDATE OF job_number ON public.timesheet_entry_job_codes
FOR EACH ROW
EXECUTE FUNCTION private.canonicalise_merged_project_job_number_child();

CREATE TRIGGER canonicalise_merged_project_job_number_scalar
BEFORE INSERT OR UPDATE OF job_number ON public.timesheet_entries
FOR EACH ROW
EXECUTE FUNCTION private.canonicalise_merged_project_job_number_scalar();

CREATE OR REPLACE FUNCTION public.convert_quote_project_numbers(
  p_project_number_ids UUID[],
  p_survivor_project_number_id UUID,
  p_cost_ids UUID[],
  p_quote JSONB,
  p_line_items JSONB,
  p_actor_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_project_count INTEGER;
  v_distinct_project_count INTEGER;
  v_cost_count INTEGER;
  v_survivor public.quote_project_numbers%ROWTYPE;
  v_quote_id UUID := (p_quote->>'id')::UUID;
  v_alias_references TEXT[];
  v_all_references TEXT[];
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('quote-project-number-alias-write', 0)
  );

  IF COALESCE(cardinality(p_project_number_ids), 0) = 0 THEN
    RAISE EXCEPTION 'Select at least one project number.';
  END IF;

  SELECT COUNT(DISTINCT project_id)
  INTO v_distinct_project_count
  FROM unnest(p_project_number_ids) AS project_id;

  IF v_distinct_project_count <> cardinality(p_project_number_ids) THEN
    RAISE EXCEPTION 'Project number selection contains duplicates.';
  END IF;

  IF NOT (p_survivor_project_number_id = ANY(p_project_number_ids)) THEN
    RAISE EXCEPTION 'The retained project number must be selected.';
  END IF;

  PERFORM id
  FROM public.quote_project_numbers
  WHERE id = ANY(p_project_number_ids)
  ORDER BY id
  FOR UPDATE;

  SELECT COUNT(*)
  INTO v_project_count
  FROM public.quote_project_numbers
  WHERE id = ANY(p_project_number_ids);

  IF v_project_count <> cardinality(p_project_number_ids) THEN
    RAISE EXCEPTION 'One or more selected project numbers no longer exist.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.quote_project_numbers
    WHERE id = ANY(p_project_number_ids)
      AND status <> 'open'
  ) THEN
    RAISE EXCEPTION 'All selected project numbers must still be open.';
  END IF;

  SELECT *
  INTO v_survivor
  FROM public.quote_project_numbers
  WHERE id = p_survivor_project_number_id;

  IF v_quote_id IS NULL
     OR NULLIF(BTRIM(p_quote->>'quote_reference'), '') IS NULL
     OR (p_quote->>'quote_reference') <> v_survivor.project_reference
     OR (p_quote->>'base_quote_reference') <> v_survivor.project_reference THEN
    RAISE EXCEPTION 'Quote reference must match the retained project number.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.quotes
    WHERE quote_reference = v_survivor.project_reference
       OR base_quote_reference = v_survivor.project_reference
  ) THEN
    RAISE EXCEPTION 'The retained project number is already used by a live quote.';
  END IF;

  IF COALESCE(cardinality(p_cost_ids), 0) = 0 THEN
    RAISE EXCEPTION 'Select at least one unlinked project cost.';
  END IF;

  IF jsonb_typeof(p_line_items) <> 'array'
     OR jsonb_array_length(p_line_items) <> cardinality(p_cost_ids) THEN
    RAISE EXCEPTION 'Project costs and quote line items do not match.';
  END IF;

  PERFORM id
  FROM public.quote_project_costs
  WHERE id = ANY(p_cost_ids)
    AND project_number_id = ANY(p_project_number_ids)
    AND linked_quote_id IS NULL
  ORDER BY id
  FOR UPDATE;

  SELECT COUNT(*)
  INTO v_cost_count
  FROM public.quote_project_costs
  WHERE id = ANY(p_cost_ids)
    AND project_number_id = ANY(p_project_number_ids)
    AND linked_quote_id IS NULL;

  IF v_cost_count <> cardinality(p_cost_ids) THEN
    RAISE EXCEPTION 'One or more selected costs are invalid or already linked.';
  END IF;

  IF (
    SELECT COUNT(DISTINCT line.cost_id)
    FROM jsonb_to_recordset(p_line_items) AS line(cost_id UUID)
  ) <> cardinality(p_cost_ids)
  OR EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_line_items) AS line(cost_id UUID)
    WHERE NOT (line.cost_id = ANY(p_cost_ids))
  ) THEN
    RAISE EXCEPTION 'Line-item cost mapping is invalid.';
  END IF;

  INSERT INTO public.quotes (
    id,
    quote_reference,
    base_quote_reference,
    quote_thread_id,
    parent_quote_id,
    revision_number,
    revision_type,
    version_label,
    requester_id,
    requester_initials,
    customer_id,
    quote_date,
    attention_name,
    attention_email,
    site_address,
    subject_line,
    project_description,
    scope,
    salutation,
    validity_days,
    pricing_mode,
    subtotal,
    total,
    status,
    commercial_status,
    manager_name,
    manager_email,
    approver_profile_id,
    signoff_name,
    signoff_title,
    created_by,
    updated_by
  )
  VALUES (
    v_quote_id,
    v_survivor.project_reference,
    v_survivor.project_reference,
    v_quote_id,
    NULL,
    0,
    'original',
    'Original',
    v_survivor.manager_profile_id,
    v_survivor.requester_initials,
    (p_quote->>'customer_id')::UUID,
    COALESCE((p_quote->>'quote_date')::DATE, CURRENT_DATE),
    NULLIF(BTRIM(p_quote->>'attention_name'), ''),
    NULLIF(BTRIM(p_quote->>'attention_email'), ''),
    NULLIF(BTRIM(p_quote->>'site_address'), ''),
    NULLIF(BTRIM(p_quote->>'subject_line'), ''),
    NULLIF(BTRIM(p_quote->>'project_description'), ''),
    NULLIF(BTRIM(p_quote->>'scope'), ''),
    NULLIF(BTRIM(p_quote->>'salutation'), ''),
    COALESCE((p_quote->>'validity_days')::INTEGER, 30),
    'itemized',
    COALESCE((p_quote->>'subtotal')::NUMERIC, 0),
    COALESCE((p_quote->>'total')::NUMERIC, 0),
    'draft',
    'open',
    NULLIF(BTRIM(p_quote->>'manager_name'), ''),
    NULLIF(BTRIM(p_quote->>'manager_email'), ''),
    (p_quote->>'approver_profile_id')::UUID,
    NULLIF(BTRIM(p_quote->>'signoff_name'), ''),
    NULLIF(BTRIM(p_quote->>'signoff_title'), ''),
    p_actor_user_id,
    p_actor_user_id
  );

  INSERT INTO public.quote_line_items (
    id,
    quote_id,
    description,
    quantity,
    unit,
    unit_rate,
    line_total,
    sort_order
  )
  SELECT
    line.id,
    v_quote_id,
    line.description,
    line.quantity,
    line.unit,
    line.unit_rate,
    line.line_total,
    line.sort_order
  FROM jsonb_to_recordset(p_line_items) AS line(
    id UUID,
    cost_id UUID,
    description TEXT,
    quantity NUMERIC,
    unit TEXT,
    unit_rate NUMERIC,
    line_total NUMERIC,
    sort_order INTEGER
  );

  UPDATE public.quote_project_costs AS cost
  SET
    linked_quote_id = v_quote_id,
    linked_quote_line_item_id = line.id,
    linked_at = v_now,
    updated_by = p_actor_user_id
  FROM jsonb_to_recordset(p_line_items) AS line(id UUID, cost_id UUID)
  WHERE cost.id = line.cost_id;

  UPDATE public.quote_project_numbers
  SET
    status = 'converted',
    converted_quote_id = v_quote_id,
    converted_at = v_now,
    updated_by = p_actor_user_id
  WHERE id = p_survivor_project_number_id;

  UPDATE public.quote_project_numbers
  SET
    status = 'merged',
    converted_quote_id = v_quote_id,
    converted_at = v_now,
    merged_into_project_number_id = p_survivor_project_number_id,
    merged_at = v_now,
    updated_by = p_actor_user_id
  WHERE id = ANY(p_project_number_ids)
    AND id <> p_survivor_project_number_id;

  SELECT
    array_agg(project_reference ORDER BY project_reference),
    array_agg(project_reference ORDER BY project_reference)
      FILTER (WHERE id <> p_survivor_project_number_id)
  INTO v_all_references, v_alias_references
  FROM public.quote_project_numbers
  WHERE id = ANY(p_project_number_ids);

  IF COALESCE(cardinality(v_alias_references), 0) > 0 THEN
    WITH alias_rows AS (
      SELECT
        job_code.id,
        job_code.timesheet_entry_id,
        ROW_NUMBER() OVER (
          PARTITION BY job_code.timesheet_entry_id
          ORDER BY job_code.display_order, job_code.id
        ) AS alias_rank,
        EXISTS (
          SELECT 1
          FROM public.timesheet_entry_job_codes AS canonical
          WHERE canonical.timesheet_entry_id = job_code.timesheet_entry_id
            AND canonical.job_number = v_survivor.project_reference
        ) AS has_canonical
      FROM public.timesheet_entry_job_codes AS job_code
      WHERE job_code.job_number = ANY(v_alias_references)
    )
    DELETE FROM public.timesheet_entry_job_codes AS job_code
    USING alias_rows
    WHERE job_code.id = alias_rows.id
      AND (alias_rows.has_canonical OR alias_rows.alias_rank > 1);

    UPDATE public.timesheet_entry_job_codes
    SET job_number = v_survivor.project_reference
    WHERE job_number = ANY(v_alias_references);

    UPDATE public.timesheet_entries
    SET job_number = v_survivor.project_reference
    WHERE job_number = ANY(v_alias_references);
  END IF;

  INSERT INTO public.quote_timeline_events (
    quote_id,
    quote_thread_id,
    quote_reference,
    event_type,
    title,
    description,
    to_status,
    actor_user_id
  )
  VALUES (
    v_quote_id,
    v_quote_id,
    v_survivor.project_reference,
    CASE WHEN cardinality(p_project_number_ids) > 1
      THEN 'project_numbers_merged'
      ELSE 'project_number_converted'
    END,
    CASE WHEN cardinality(p_project_number_ids) > 1
      THEN 'Project numbers merged'
      ELSE 'Project number converted'
    END,
    CASE WHEN cardinality(p_project_number_ids) > 1
      THEN format(
        '%s project numbers converted. Retained %s; aliases: %s.',
        cardinality(p_project_number_ids),
        v_survivor.project_reference,
        array_to_string(v_alias_references, ', ')
      )
      ELSE 'Project number converted into a draft quote.'
    END,
    'draft',
    p_actor_user_id
  );

  RETURN jsonb_build_object(
    'quote_id', v_quote_id,
    'survivor_project_number_id', p_survivor_project_number_id,
    'project_number_ids', to_jsonb(p_project_number_ids),
    'references', to_jsonb(v_all_references),
    'aliases', to_jsonb(COALESCE(v_alias_references, ARRAY[]::TEXT[]))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.convert_quote_project_numbers(
  UUID[], UUID, UUID[], JSONB, JSONB, UUID
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.convert_quote_project_numbers(
  UUID[], UUID, UUID[], JSONB, JSONB, UUID
) TO service_role;

COMMENT ON FUNCTION public.convert_quote_project_numbers(
  UUID[], UUID, UUID[], JSONB, JSONB, UUID
) IS 'Atomically converts and optionally merges open project numbers into one live quote.';

COMMIT;
