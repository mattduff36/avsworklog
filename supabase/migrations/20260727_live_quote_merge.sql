BEGIN;

CREATE TABLE IF NOT EXISTS public.quote_merge_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survivor_quote_thread_id UUID NOT NULL REFERENCES public.quotes(id) ON DELETE RESTRICT,
  merge_mode TEXT NOT NULL CHECK (merge_mode IN ('consolidated', 'grouped')),
  merged_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  merged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (survivor_quote_thread_id)
);

ALTER TABLE public.quote_merge_groups
  ADD COLUMN IF NOT EXISTS consolidated_quote_id UUID REFERENCES public.quotes(id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS public.quote_merge_members (
  merge_group_id UUID NOT NULL REFERENCES public.quote_merge_groups(id) ON DELETE CASCADE,
  quote_thread_id UUID NOT NULL REFERENCES public.quotes(id) ON DELETE RESTRICT,
  source_latest_quote_id UUID NOT NULL REFERENCES public.quotes(id) ON DELETE RESTRICT,
  base_quote_reference TEXT NOT NULL,
  is_survivor BOOLEAN NOT NULL DEFAULT FALSE,
  original_sage_posted_at TIMESTAMPTZ,
  original_sage_posted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  merged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (merge_group_id, quote_thread_id),
  UNIQUE (quote_thread_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_quote_merge_members_one_survivor
  ON public.quote_merge_members(merge_group_id)
  WHERE is_survivor;

CREATE TABLE IF NOT EXISTS public.quote_reference_aliases (
  alias_reference TEXT PRIMARY KEY,
  merge_group_id UUID NOT NULL REFERENCES public.quote_merge_groups(id) ON DELETE CASCADE,
  source_quote_thread_id UUID NOT NULL REFERENCES public.quotes(id) ON DELETE RESTRICT,
  canonical_quote_thread_id UUID NOT NULL REFERENCES public.quotes(id) ON DELETE RESTRICT,
  canonical_reference TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (alias_reference = UPPER(BTRIM(alias_reference))),
  CHECK (canonical_reference = UPPER(BTRIM(canonical_reference)))
);

CREATE INDEX IF NOT EXISTS idx_quote_reference_aliases_canonical
  ON public.quote_reference_aliases(canonical_quote_thread_id);

CREATE TABLE IF NOT EXISTS public.quote_pdf_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL UNIQUE REFERENCES public.quotes(id) ON DELETE RESTRICT,
  merge_group_id UUID NOT NULL REFERENCES public.quote_merge_groups(id) ON DELETE CASCADE,
  original_reference TEXT NOT NULL,
  version_label TEXT,
  storage_path TEXT NOT NULL UNIQUE,
  file_sha256 TEXT NOT NULL CHECK (file_sha256 ~ '^[a-f0-9]{64}$'),
  file_size BIGINT NOT NULL CHECK (file_size > 0),
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.quote_line_item_merge_sources (
  consolidated_line_item_id UUID PRIMARY KEY REFERENCES public.quote_line_items(id) ON DELETE CASCADE,
  merge_group_id UUID NOT NULL REFERENCES public.quote_merge_groups(id) ON DELETE CASCADE,
  source_quote_thread_id UUID NOT NULL REFERENCES public.quotes(id) ON DELETE RESTRICT,
  source_quote_id UUID NOT NULL REFERENCES public.quotes(id) ON DELETE RESTRICT,
  source_line_item_id UUID NOT NULL REFERENCES public.quote_line_items(id) ON DELETE RESTRICT,
  source_quote_reference TEXT NOT NULL
);

ALTER TABLE public.quote_line_item_merge_sources
  DROP CONSTRAINT IF EXISTS quote_line_item_merge_sources_merge_group_id_source_line_item_id_key;

CREATE TABLE IF NOT EXISTS public.quote_billing_source_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_invoice_id UUID REFERENCES public.quote_invoices(id) ON DELETE CASCADE,
  quote_invoice_request_id UUID REFERENCES public.quote_invoice_requests(id) ON DELETE CASCADE,
  source_quote_thread_id UUID NOT NULL REFERENCES public.quotes(id) ON DELETE RESTRICT,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (num_nonnulls(quote_invoice_id, quote_invoice_request_id) = 1)
);

ALTER TABLE public.quote_invoices
  ADD COLUMN IF NOT EXISTS merge_billing_scope TEXT NOT NULL DEFAULT 'single',
  ADD COLUMN IF NOT EXISTS merge_source_thread_ids UUID[] NOT NULL DEFAULT '{}';

ALTER TABLE public.quote_invoices
  DROP CONSTRAINT IF EXISTS quote_invoices_merge_billing_scope_check,
  ADD CONSTRAINT quote_invoices_merge_billing_scope_check
  CHECK (merge_billing_scope IN ('single', 'combined', 'source'));

ALTER TABLE public.quote_invoice_requests
  ADD COLUMN IF NOT EXISTS merge_billing_scope TEXT NOT NULL DEFAULT 'single',
  ADD COLUMN IF NOT EXISTS merge_source_thread_ids UUID[] NOT NULL DEFAULT '{}';

ALTER TABLE public.quote_invoice_requests
  DROP CONSTRAINT IF EXISTS quote_invoice_requests_merge_billing_scope_check,
  ADD CONSTRAINT quote_invoice_requests_merge_billing_scope_check
  CHECK (merge_billing_scope IN ('single', 'combined', 'source'));

CREATE INDEX IF NOT EXISTS idx_quote_merge_groups_survivor
  ON public.quote_merge_groups(survivor_quote_thread_id);
CREATE INDEX IF NOT EXISTS idx_quote_merge_members_group
  ON public.quote_merge_members(merge_group_id);
CREATE INDEX IF NOT EXISTS idx_quote_pdf_snapshots_group
  ON public.quote_pdf_snapshots(merge_group_id);
CREATE INDEX IF NOT EXISTS idx_quote_line_item_merge_sources_group
  ON public.quote_line_item_merge_sources(merge_group_id);
CREATE INDEX IF NOT EXISTS idx_quote_billing_source_allocations_source
  ON public.quote_billing_source_allocations(source_quote_thread_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_quote_billing_source_allocations_invoice
  ON public.quote_billing_source_allocations(quote_invoice_id, source_quote_thread_id)
  WHERE quote_invoice_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_quote_billing_source_allocations_request
  ON public.quote_billing_source_allocations(quote_invoice_request_id, source_quote_thread_id)
  WHERE quote_invoice_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quote_invoices_merge_sources
  ON public.quote_invoices USING GIN(merge_source_thread_ids);
CREATE INDEX IF NOT EXISTS idx_quote_invoice_requests_merge_sources
  ON public.quote_invoice_requests USING GIN(merge_source_thread_ids);

ALTER TABLE public.quote_merge_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_merge_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_reference_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_pdf_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_line_item_merge_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_billing_source_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quote_merge_groups_select ON public.quote_merge_groups;
CREATE POLICY quote_merge_groups_select ON public.quote_merge_groups
  FOR SELECT USING ((SELECT public.effective_is_manager_admin()));

DROP POLICY IF EXISTS quote_merge_members_select ON public.quote_merge_members;
CREATE POLICY quote_merge_members_select ON public.quote_merge_members
  FOR SELECT USING ((SELECT public.effective_is_manager_admin()));

DROP POLICY IF EXISTS quote_reference_aliases_select ON public.quote_reference_aliases;
CREATE POLICY quote_reference_aliases_select ON public.quote_reference_aliases
  FOR SELECT USING ((SELECT public.effective_is_manager_admin()));

DROP POLICY IF EXISTS quote_pdf_snapshots_select ON public.quote_pdf_snapshots;
CREATE POLICY quote_pdf_snapshots_select ON public.quote_pdf_snapshots
  FOR SELECT USING ((SELECT public.effective_is_manager_admin()));

DROP POLICY IF EXISTS quote_line_item_merge_sources_select ON public.quote_line_item_merge_sources;
CREATE POLICY quote_line_item_merge_sources_select ON public.quote_line_item_merge_sources
  FOR SELECT USING ((SELECT public.effective_is_manager_admin()));

DROP POLICY IF EXISTS quote_billing_source_allocations_select ON public.quote_billing_source_allocations;
CREATE POLICY quote_billing_source_allocations_select ON public.quote_billing_source_allocations
  FOR SELECT USING ((SELECT public.effective_is_manager_admin()));

INSERT INTO storage.buckets (id, name, public)
VALUES ('quote-pdf-snapshots', 'quote-pdf-snapshots', FALSE)
ON CONFLICT (id) DO UPDATE SET public = FALSE;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.resolve_merged_project_reference(p_reference TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reference TEXT := UPPER(BTRIM(p_reference));
  v_canonical_reference TEXT;
BEGIN
  IF p_reference IS NULL OR v_reference = '' THEN
    RETURN NULL;
  END IF;

  -- Serialize all project/live quote alias reads and writes. This intentionally
  -- reuses the project-merge lock to avoid cross-feature lock-order deadlocks.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('quote-project-number-alias-write', 0)
  );

  SELECT alias.canonical_reference
  INTO v_canonical_reference
  FROM public.quote_reference_aliases AS alias
  WHERE alias.alias_reference = v_reference
  LIMIT 1;

  IF v_canonical_reference IS NOT NULL THEN
    RETURN v_canonical_reference;
  END IF;

  SELECT CASE
    WHEN alias.status = 'merged' THEN canonical.project_reference
    ELSE NULL
  END
  INTO v_canonical_reference
  FROM public.quote_project_numbers AS alias
  LEFT JOIN public.quote_project_numbers AS canonical
    ON canonical.id = alias.merged_into_project_number_id
  WHERE alias.project_reference = v_reference
  LIMIT 1;

  RETURN v_canonical_reference;
END;
$$;

REVOKE ALL ON FUNCTION private.resolve_merged_project_reference(TEXT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.resolve_live_quote_reference(p_reference TEXT)
RETURNS TABLE (
  canonical_quote_thread_id UUID,
  canonical_reference TEXT,
  alias_reference TEXT
)
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    alias.canonical_quote_thread_id,
    alias.canonical_reference,
    alias.alias_reference
  FROM public.quote_reference_aliases AS alias
  WHERE alias.alias_reference = UPPER(BTRIM(p_reference))
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.reserve_quote_billing_sources(
  p_parent_type TEXT,
  p_parent_id UUID,
  p_allocations JSONB,
  p_source_capacities JSONB,
  p_exclude_request_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_parent_amount NUMERIC;
  v_parent_quote_id UUID;
  v_group_id UUID;
  v_allocation RECORD;
  v_capacity NUMERIC;
  v_historical_invoiced NUMERIC;
  v_historical_pending NUMERIC;
  v_merged_allocated NUMERIC;
BEGIN
  IF p_parent_type NOT IN ('invoice', 'request')
     OR jsonb_typeof(p_allocations) <> 'array'
     OR jsonb_array_length(p_allocations) = 0 THEN
    RAISE EXCEPTION 'Valid merged quote billing allocations are required.';
  END IF;

  IF p_parent_type = 'invoice' THEN
    SELECT amount, quote_id
    INTO v_parent_amount, v_parent_quote_id
    FROM public.quote_invoices
    WHERE id = p_parent_id
    FOR UPDATE;
  ELSE
    SELECT requested_amount, quote_id
    INTO v_parent_amount, v_parent_quote_id
    FROM public.quote_invoice_requests
    WHERE id = p_parent_id
    FOR UPDATE;
  END IF;

  IF v_parent_quote_id IS NULL THEN
    RAISE EXCEPTION 'Billing parent record was not found.';
  END IF;

  SELECT member.merge_group_id
  INTO v_group_id
  FROM public.quotes AS quote
  JOIN public.quote_merge_members AS member
    ON member.quote_thread_id = quote.quote_thread_id
   AND member.is_survivor
  WHERE quote.id = v_parent_quote_id;

  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'Billing source allocations require a merged quote survivor.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('quote-merge-billing-' || v_group_id::TEXT, 0)
  );

  IF (
    SELECT ROUND(COALESCE(SUM(allocation.amount), 0), 2)
    FROM jsonb_to_recordset(p_allocations) AS allocation(
      source_quote_thread_id UUID,
      amount NUMERIC
    )
  ) <> ROUND(v_parent_amount, 2) THEN
    RAISE EXCEPTION 'Billing source allocations must equal the parent amount.';
  END IF;

  FOR v_allocation IN
    SELECT
      allocation.source_quote_thread_id,
      ROUND(SUM(allocation.amount), 2) AS amount
    FROM jsonb_to_recordset(p_allocations) AS allocation(
      source_quote_thread_id UUID,
      amount NUMERIC
    )
    GROUP BY allocation.source_quote_thread_id
  LOOP
    IF v_allocation.amount <= 0 OR NOT EXISTS (
      SELECT 1
      FROM public.quote_merge_members
      WHERE merge_group_id = v_group_id
        AND quote_thread_id = v_allocation.source_quote_thread_id
    ) THEN
      RAISE EXCEPTION 'Invalid merged quote billing source.';
    END IF;

    v_capacity := COALESCE(
      (p_source_capacities->>v_allocation.source_quote_thread_id::TEXT)::NUMERIC,
      0
    );

    SELECT COALESCE(SUM(invoice.amount), 0)
    INTO v_historical_invoiced
    FROM public.quote_invoices AS invoice
    JOIN public.quotes AS quote ON quote.id = invoice.quote_id
    WHERE quote.quote_thread_id = v_allocation.source_quote_thread_id
      AND invoice.merge_billing_scope = 'single';

    SELECT COALESCE(SUM(request.requested_amount), 0)
    INTO v_historical_pending
    FROM public.quote_invoice_requests AS request
    JOIN public.quotes AS quote ON quote.id = request.quote_id
    WHERE quote.quote_thread_id = v_allocation.source_quote_thread_id
      AND request.status = 'pending'
      AND request.merge_billing_scope = 'single';

    SELECT COALESCE(SUM(source.amount), 0)
    INTO v_merged_allocated
    FROM public.quote_billing_source_allocations AS source
    LEFT JOIN public.quote_invoice_requests AS request
      ON request.id = source.quote_invoice_request_id
    WHERE source.source_quote_thread_id = v_allocation.source_quote_thread_id
      AND (
        source.quote_invoice_id IS NOT NULL
        OR (
          request.status = 'pending'
          AND request.id IS DISTINCT FROM p_exclude_request_id
        )
      )
      AND NOT (
        p_parent_type = 'invoice'
        AND source.quote_invoice_id = p_parent_id
      )
      AND NOT (
        p_parent_type = 'request'
        AND source.quote_invoice_request_id = p_parent_id
      );

    IF ROUND(
      v_historical_invoiced
      + v_historical_pending
      + v_merged_allocated
      + v_allocation.amount,
      2
    ) > ROUND(v_capacity, 2) THEN
      RAISE EXCEPTION 'A selected merged quote source no longer has enough remaining balance.';
    END IF;
  END LOOP;

  IF p_parent_type = 'invoice' THEN
    INSERT INTO public.quote_billing_source_allocations (
      quote_invoice_id,
      source_quote_thread_id,
      amount
    )
    SELECT
      p_parent_id,
      allocation.source_quote_thread_id,
      ROUND(SUM(allocation.amount), 2)
    FROM jsonb_to_recordset(p_allocations) AS allocation(
      source_quote_thread_id UUID,
      amount NUMERIC
    )
    GROUP BY allocation.source_quote_thread_id;
  ELSE
    INSERT INTO public.quote_billing_source_allocations (
      quote_invoice_request_id,
      source_quote_thread_id,
      amount
    )
    SELECT
      p_parent_id,
      allocation.source_quote_thread_id,
      ROUND(SUM(allocation.amount), 2)
    FROM jsonb_to_recordset(p_allocations) AS allocation(
      source_quote_thread_id UUID,
      amount NUMERIC
    )
    GROUP BY allocation.source_quote_thread_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_quote_billing_sources(
  TEXT, UUID, JSONB, JSONB, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_quote_billing_sources(
  TEXT, UUID, JSONB, JSONB, UUID
) TO service_role;

CREATE OR REPLACE FUNCTION public.merge_live_quotes(
  p_quote_ids UUID[],
  p_survivor_quote_id UUID,
  p_merge_mode TEXT,
  p_consolidated_quote JSONB,
  p_line_items JSONB,
  p_snapshots JSONB,
  p_actor_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_selected_count INTEGER;
  v_thread_count INTEGER;
  v_version_count INTEGER;
  v_snapshot_count INTEGER;
  v_group_id UUID;
  v_existing_group_id UUID;
  v_survivor public.quotes%ROWTYPE;
  v_new_quote_id UUID;
  v_canonical_reference TEXT;
  v_aliases TEXT[];
  v_source_sage_active BOOLEAN;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('quote-project-number-alias-write', 0)
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    JOIN public.roles AS role ON role.id = profile.role_id
    WHERE profile.id = p_actor_user_id
      AND (
        role.role_class = 'admin'
        OR role.name = 'admin'
        OR COALESCE(role.is_super_admin, FALSE)
      )
  ) THEN
    RAISE EXCEPTION 'Only administrators can merge live quotes.';
  END IF;

  IF p_merge_mode NOT IN ('consolidated', 'grouped') THEN
    RAISE EXCEPTION 'Choose consolidated or grouped document handling.';
  END IF;

  IF COALESCE(cardinality(p_quote_ids), 0) < 2 THEN
    RAISE EXCEPTION 'Select at least two quotes to merge.';
  END IF;

  SELECT COUNT(DISTINCT selected_id)
  INTO v_selected_count
  FROM unnest(p_quote_ids) AS selected_id;

  IF v_selected_count <> cardinality(p_quote_ids) THEN
    RAISE EXCEPTION 'Quote selection contains duplicates.';
  END IF;

  IF NOT (p_survivor_quote_id = ANY(p_quote_ids)) THEN
    RAISE EXCEPTION 'The retained quote must be selected.';
  END IF;

  PERFORM quote.id
  FROM public.quotes AS quote
  WHERE quote.id = ANY(p_quote_ids)
  ORDER BY quote.id
  FOR UPDATE;

  SELECT COUNT(*), COUNT(DISTINCT quote.quote_thread_id)
  INTO v_selected_count, v_thread_count
  FROM public.quotes AS quote
  WHERE quote.id = ANY(p_quote_ids);

  IF v_selected_count <> cardinality(p_quote_ids)
     OR v_thread_count <> cardinality(p_quote_ids) THEN
    RAISE EXCEPTION 'Each selected quote must exist and belong to a different thread.';
  END IF;

  PERFORM line.id
  FROM public.quote_line_items AS line
  JOIN public.quotes AS version ON version.id = line.quote_id
  JOIN public.quotes AS selected
    ON selected.id = ANY(p_quote_ids)
   AND selected.quote_thread_id = version.quote_thread_id
  ORDER BY line.id
  FOR UPDATE OF line;

  SELECT *
  INTO v_survivor
  FROM public.quotes
  WHERE id = p_survivor_quote_id;

  SELECT member.merge_group_id
  INTO v_existing_group_id
  FROM public.quote_merge_members AS member
  WHERE member.quote_thread_id = v_survivor.quote_thread_id
    AND member.is_survivor;

  IF v_existing_group_id IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.quote_merge_groups
       WHERE id = v_existing_group_id
         AND merge_mode = p_merge_mode
     )
     AND (
       SELECT COUNT(DISTINCT member.quote_thread_id)
       FROM public.quote_merge_members AS member
       JOIN public.quotes AS selected
         ON selected.id = ANY(p_quote_ids)
        AND selected.quote_thread_id = member.quote_thread_id
       WHERE member.merge_group_id = v_existing_group_id
     ) = cardinality(p_quote_ids) THEN
    SELECT latest.id
    INTO v_new_quote_id
    FROM public.quotes AS latest
    WHERE latest.quote_thread_id = v_survivor.quote_thread_id
      AND latest.is_latest_version
    LIMIT 1;

    SELECT array_agg(alias.alias_reference ORDER BY alias.alias_reference)
    INTO v_aliases
    FROM public.quote_reference_aliases AS alias
    WHERE alias.merge_group_id = v_existing_group_id;

    RETURN jsonb_build_object(
      'merge_group_id', v_existing_group_id,
      'quote_id', v_new_quote_id,
      'quote_thread_id', v_survivor.quote_thread_id,
      'canonical_reference', UPPER(v_survivor.base_quote_reference),
      'aliases', COALESCE(to_jsonb(v_aliases), '[]'::JSONB),
      'merge_mode', p_merge_mode
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.quotes AS quote
    WHERE quote.id = ANY(p_quote_ids)
      AND (
        NOT quote.is_latest_version
        OR quote.commercial_status <> 'open'
      )
  ) THEN
    RAISE EXCEPTION 'All selected quotes must be the latest commercially open versions.';
  END IF;

  IF (
    SELECT COUNT(DISTINCT quote.customer_id)
    FROM public.quotes AS quote
    WHERE quote.id = ANY(p_quote_ids)
  ) <> 1 THEN
    RAISE EXCEPTION 'Quotes can only be merged for the same customer.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.quotes AS quote
    WHERE quote.id = ANY(p_quote_ids) AND quote.requester_id IS NULL
  ) OR (
    SELECT COUNT(DISTINCT quote.requester_id)
    FROM public.quotes AS quote
    WHERE quote.id = ANY(p_quote_ids)
  ) <> 1 THEN
    RAISE EXCEPTION 'Quotes can only be merged when they have the same manager.';
  END IF;

  v_canonical_reference := UPPER(v_survivor.base_quote_reference);

  SELECT member.merge_group_id
  INTO v_existing_group_id
  FROM public.quote_merge_members AS member
  WHERE member.quote_thread_id = v_survivor.quote_thread_id;

  IF v_existing_group_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.quote_merge_members
    WHERE merge_group_id = v_existing_group_id
      AND quote_thread_id = v_survivor.quote_thread_id
      AND is_survivor
  ) THEN
    RAISE EXCEPTION 'A retired quote cannot become a merge survivor.';
  END IF;

  IF v_existing_group_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.quote_merge_groups
    WHERE id = v_existing_group_id
      AND merge_mode <> p_merge_mode
  ) THEN
    RAISE EXCEPTION 'An existing merge group cannot change document handling mode.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.quote_merge_members AS member
    JOIN public.quotes AS selected
      ON selected.quote_thread_id = member.quote_thread_id
    WHERE selected.id = ANY(p_quote_ids)
      AND selected.quote_thread_id <> v_survivor.quote_thread_id
      AND member.merge_group_id <> v_existing_group_id
  ) THEN
    RAISE EXCEPTION 'One or more selected quotes have already been merged.';
  END IF;

  SELECT COUNT(*)
  INTO v_version_count
  FROM public.quotes AS version
  JOIN public.quotes AS selected
    ON selected.id = ANY(p_quote_ids)
   AND selected.quote_thread_id = version.quote_thread_id;

  IF jsonb_typeof(p_snapshots) <> 'array' THEN
    RAISE EXCEPTION 'PDF snapshots are required for every quote version.';
  END IF;
  IF jsonb_array_length(p_snapshots) <> v_version_count THEN
    RAISE EXCEPTION 'PDF snapshot payload must exactly match the selected quote versions.';
  END IF;

  SELECT COUNT(DISTINCT snapshot.quote_id)
  INTO v_snapshot_count
  FROM jsonb_to_recordset(p_snapshots) AS snapshot(
    quote_id UUID,
    quote_updated_at TIMESTAMPTZ,
    line_state JSONB,
    storage_path TEXT,
    file_sha256 TEXT,
    file_size BIGINT
  )
  JOIN public.quotes AS version ON version.id = snapshot.quote_id
  JOIN public.quotes AS selected
    ON selected.id = ANY(p_quote_ids)
   AND selected.quote_thread_id = version.quote_thread_id
  WHERE NULLIF(BTRIM(snapshot.storage_path), '') IS NOT NULL
    AND snapshot.file_sha256 ~ '^[a-f0-9]{64}$'
    AND snapshot.file_size > 0
    AND version.updated_at IS NOT DISTINCT FROM snapshot.quote_updated_at
    AND snapshot.line_state = (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'description', line.description,
            'quantity', line.quantity,
            'unit', line.unit,
            'unit_rate', line.unit_rate,
            'line_total', line.line_total,
            'sort_order', line.sort_order
          )
          ORDER BY line.sort_order, line.id
        ),
        '[]'::JSONB
      )
      FROM public.quote_line_items AS line
      WHERE line.quote_id = version.id
    );

  IF v_snapshot_count <> v_version_count THEN
    RAISE EXCEPTION 'Every selected quote version must have a valid immutable PDF snapshot.';
  END IF;

  IF v_existing_group_id IS NULL THEN
    INSERT INTO public.quote_merge_groups (
      survivor_quote_thread_id,
      merge_mode,
      merged_by,
      merged_at,
      updated_at
    )
    VALUES (
      v_survivor.quote_thread_id,
      p_merge_mode,
      p_actor_user_id,
      v_now,
      v_now
    )
    RETURNING id INTO v_group_id;
  ELSE
    v_group_id := v_existing_group_id;
    UPDATE public.quote_merge_groups
    SET merge_mode = p_merge_mode, updated_at = v_now
    WHERE id = v_group_id;
  END IF;

  INSERT INTO public.quote_merge_members (
    merge_group_id,
    quote_thread_id,
    source_latest_quote_id,
    base_quote_reference,
    is_survivor,
    original_sage_posted_at,
    original_sage_posted_by,
    merged_at
  )
  SELECT
    v_group_id,
    selected.quote_thread_id,
    selected.id,
    UPPER(selected.base_quote_reference),
    selected.quote_thread_id = v_survivor.quote_thread_id,
    selected.sage_posted_at,
    selected.sage_posted_by,
    v_now
  FROM public.quotes AS selected
  WHERE selected.id = ANY(p_quote_ids)
  ON CONFLICT (quote_thread_id) DO UPDATE
  SET
    source_latest_quote_id = EXCLUDED.source_latest_quote_id,
    is_survivor = EXCLUDED.is_survivor;

  INSERT INTO public.quote_pdf_snapshots (
    quote_id,
    merge_group_id,
    original_reference,
    version_label,
    storage_path,
    file_sha256,
    file_size,
    created_by,
    created_at
  )
  SELECT
    snapshot.quote_id,
    v_group_id,
    version.quote_reference,
    version.version_label,
    snapshot.storage_path,
    snapshot.file_sha256,
    snapshot.file_size,
    p_actor_user_id,
    v_now
  FROM jsonb_to_recordset(p_snapshots) AS snapshot(
    quote_id UUID,
    quote_updated_at TIMESTAMPTZ,
    line_state JSONB,
    storage_path TEXT,
    file_sha256 TEXT,
    file_size BIGINT
  )
  JOIN public.quotes AS version ON version.id = snapshot.quote_id
  JOIN public.quotes AS selected
    ON selected.id = ANY(p_quote_ids)
   AND selected.quote_thread_id = version.quote_thread_id
  ON CONFLICT (quote_id) DO NOTHING;

  IF EXISTS (
    SELECT 1
    FROM public.quote_reference_aliases AS existing
    JOIN public.quotes AS source
      ON source.quote_thread_id = existing.source_quote_thread_id
    JOIN public.quotes AS selected
      ON selected.id = ANY(p_quote_ids)
     AND selected.quote_thread_id = source.quote_thread_id
    WHERE existing.canonical_quote_thread_id <> v_survivor.quote_thread_id
  ) THEN
    RAISE EXCEPTION 'A selected quote reference is already assigned to another merge.';
  END IF;

  INSERT INTO public.quote_reference_aliases (
    alias_reference,
    merge_group_id,
    source_quote_thread_id,
    canonical_quote_thread_id,
    canonical_reference,
    created_by,
    created_at
  )
  SELECT DISTINCT
    reference.alias_reference,
    v_group_id,
    source.quote_thread_id,
    v_survivor.quote_thread_id,
    v_canonical_reference,
    p_actor_user_id,
    v_now
  FROM public.quotes AS source
  JOIN public.quotes AS selected
    ON selected.id = ANY(p_quote_ids)
   AND selected.quote_thread_id = source.quote_thread_id
  CROSS JOIN LATERAL (
    VALUES
      (UPPER(source.quote_reference)),
      (UPPER(source.base_quote_reference))
  ) AS reference(alias_reference)
  WHERE source.quote_thread_id <> v_survivor.quote_thread_id
  ON CONFLICT (alias_reference) DO UPDATE
  SET
    merge_group_id = EXCLUDED.merge_group_id,
    canonical_quote_thread_id = EXCLUDED.canonical_quote_thread_id,
    canonical_reference = EXCLUDED.canonical_reference;

  SELECT array_agg(alias.alias_reference ORDER BY alias.alias_reference)
  INTO v_aliases
  FROM public.quote_reference_aliases AS alias
  WHERE alias.merge_group_id = v_group_id;

  SELECT EXISTS (
    SELECT 1
    FROM public.quotes AS version
    JOIN public.quotes AS selected
      ON selected.id = ANY(p_quote_ids)
     AND selected.quote_thread_id = version.quote_thread_id
    WHERE version.sage_posted_at IS NOT NULL
  )
  INTO v_source_sage_active;

  IF v_source_sage_active THEN
    UPDATE public.quotes
    SET
      sage_posted_at = COALESCE(sage_posted_at, v_now),
      sage_posted_by = COALESCE(sage_posted_by, p_actor_user_id),
      updated_by = p_actor_user_id
    WHERE quote_thread_id = v_survivor.quote_thread_id;
  END IF;

  IF p_merge_mode = 'consolidated' THEN
    IF jsonb_typeof(p_consolidated_quote) <> 'object'
       OR jsonb_typeof(p_line_items) <> 'array' THEN
      RAISE EXCEPTION 'Consolidated quote and line items are required.';
    END IF;

    v_new_quote_id := (p_consolidated_quote->>'id')::UUID;
    IF v_new_quote_id IS NULL
       OR (p_consolidated_quote->>'quote_thread_id')::UUID <> v_survivor.quote_thread_id
       OR UPPER(p_consolidated_quote->>'base_quote_reference') <> v_canonical_reference
       OR (p_consolidated_quote->>'parent_quote_id')::UUID <> v_survivor.id THEN
      RAISE EXCEPTION 'Consolidated quote metadata does not match the survivor.';
    END IF;

    PERFORM source_line.id
    FROM public.quote_line_items AS source_line
    WHERE source_line.id IN (
      SELECT line.copy_line_item_id
      FROM jsonb_to_recordset(p_line_items) AS line(copy_line_item_id UUID)
      UNION
      SELECT line.source_line_item_id
      FROM jsonb_to_recordset(p_line_items) AS line(source_line_item_id UUID)
    )
    ORDER BY source_line.id
    FOR UPDATE;

    IF (
      SELECT COUNT(*)
      FROM jsonb_to_recordset(p_line_items) AS line(
        source_quote_thread_id UUID,
        source_quote_id UUID,
        source_line_item_id UUID,
        copy_line_item_id UUID,
        source_quote_reference TEXT,
        description TEXT,
        quantity NUMERIC,
        unit TEXT,
        unit_rate NUMERIC,
        line_total NUMERIC
      )
      JOIN public.quote_line_items AS copy_line
        ON copy_line.id = line.copy_line_item_id
      JOIN public.quotes AS copy_quote
        ON copy_quote.id = copy_line.quote_id
       AND copy_quote.id = ANY(p_quote_ids)
      JOIN public.quote_line_items AS source_line
        ON source_line.id = line.source_line_item_id
      JOIN public.quotes AS source_quote
        ON source_quote.id = source_line.quote_id
       AND source_quote.id = line.source_quote_id
       AND source_quote.quote_thread_id = line.source_quote_thread_id
      JOIN public.quotes AS selected_source_thread
        ON selected_source_thread.id = ANY(p_quote_ids)
       AND selected_source_thread.quote_thread_id = source_quote.quote_thread_id
      WHERE copy_line.description = line.description
        AND copy_line.quantity = line.quantity
        AND copy_line.unit IS NOT DISTINCT FROM line.unit
        AND copy_line.unit_rate = line.unit_rate
        AND copy_line.line_total = line.line_total
        AND UPPER(source_quote.base_quote_reference) = UPPER(line.source_quote_reference)
    ) <> jsonb_array_length(p_line_items)
    OR (
      SELECT COUNT(DISTINCT line.copy_line_item_id)
      FROM jsonb_to_recordset(p_line_items) AS line(copy_line_item_id UUID)
    ) <> jsonb_array_length(p_line_items) THEN
      RAISE EXCEPTION 'One or more consolidated quote lines are not from the selected latest versions.';
    END IF;

    UPDATE public.quotes
    SET is_latest_version = FALSE, updated_by = p_actor_user_id
    WHERE quote_thread_id = v_survivor.quote_thread_id
      AND is_latest_version;

    INSERT INTO public.quotes (
      id, quote_reference, base_quote_reference, quote_thread_id,
      parent_quote_id, revision_number, revision_type, version_label,
      version_notes, is_latest_version, customer_id, requester_id,
      requester_initials, quote_date, attention_name, attention_email,
      subject_line, project_description, scope, site_address, salutation,
      validity_days, pricing_mode, subtotal, total, status, accepted,
      po_number, po_value, po_received_at, started, invoice_number,
      invoice_notes, signoff_name, signoff_title, custom_footer_text,
      manager_name, manager_email, approver_profile_id, completion_status,
      commercial_status, start_date, start_alert_days,
      estimated_duration_days, sage_posted_at, sage_posted_by,
      created_by, updated_by
    )
    VALUES (
      v_new_quote_id,
      p_consolidated_quote->>'quote_reference',
      v_canonical_reference,
      v_survivor.quote_thread_id,
      v_survivor.id,
      (p_consolidated_quote->>'revision_number')::INTEGER,
      'revision',
      p_consolidated_quote->>'version_label',
      p_consolidated_quote->>'version_notes',
      TRUE,
      v_survivor.customer_id,
      v_survivor.requester_id,
      v_survivor.requester_initials,
      COALESCE((p_consolidated_quote->>'quote_date')::DATE, CURRENT_DATE),
      v_survivor.attention_name,
      v_survivor.attention_email,
      v_survivor.subject_line,
      NULLIF(p_consolidated_quote->>'project_description', ''),
      NULLIF(p_consolidated_quote->>'scope', ''),
      v_survivor.site_address,
      v_survivor.salutation,
      v_survivor.validity_days,
      'itemized',
      COALESCE((p_consolidated_quote->>'subtotal')::NUMERIC, 0),
      COALESCE((p_consolidated_quote->>'total')::NUMERIC, 0),
      'draft',
      FALSE,
      v_survivor.po_number,
      v_survivor.po_value,
      v_survivor.po_received_at,
      v_survivor.started,
      NULL,
      NULL,
      v_survivor.signoff_name,
      v_survivor.signoff_title,
      v_survivor.custom_footer_text,
      v_survivor.manager_name,
      v_survivor.manager_email,
      v_survivor.approver_profile_id,
      'not_completed',
      'open',
      v_survivor.start_date,
      v_survivor.start_alert_days,
      v_survivor.estimated_duration_days,
      CASE WHEN v_source_sage_active THEN v_now ELSE v_survivor.sage_posted_at END,
      CASE WHEN v_source_sage_active THEN p_actor_user_id ELSE v_survivor.sage_posted_by END,
      p_actor_user_id,
      p_actor_user_id
    );

    INSERT INTO public.quote_line_items (
      id, quote_id, description, quantity, unit, unit_rate, line_total, sort_order
    )
    SELECT
      line.id,
      v_new_quote_id,
      line.description,
      line.quantity,
      line.unit,
      line.unit_rate,
      line.line_total,
      line.sort_order
    FROM jsonb_to_recordset(p_line_items) AS line(
      id UUID,
      source_quote_thread_id UUID,
      source_quote_id UUID,
      source_line_item_id UUID,
      copy_line_item_id UUID,
      source_quote_reference TEXT,
      description TEXT,
      quantity NUMERIC,
      unit TEXT,
      unit_rate NUMERIC,
      line_total NUMERIC,
      sort_order INTEGER
    );

    INSERT INTO public.quote_line_item_merge_sources (
      consolidated_line_item_id,
      merge_group_id,
      source_quote_thread_id,
      source_quote_id,
      source_line_item_id,
      source_quote_reference
    )
    SELECT
      line.id,
      v_group_id,
      line.source_quote_thread_id,
      line.source_quote_id,
      line.source_line_item_id,
      line.source_quote_reference
    FROM jsonb_to_recordset(p_line_items) AS line(
      id UUID,
      source_quote_thread_id UUID,
      source_quote_id UUID,
      source_line_item_id UUID,
      source_quote_reference TEXT
    );

    UPDATE public.quote_merge_groups
    SET consolidated_quote_id = v_new_quote_id, updated_at = v_now
    WHERE id = v_group_id;
  ELSE
    v_new_quote_id := v_survivor.id;
  END IF;

  INSERT INTO public.quote_timeline_events (
    quote_id,
    quote_thread_id,
    quote_reference,
    event_type,
    title,
    description,
    actor_user_id,
    created_at
  )
  SELECT
    selected.id,
    selected.quote_thread_id,
    selected.quote_reference,
    CASE
      WHEN selected.quote_thread_id = v_survivor.quote_thread_id
        THEN 'quotes_merged'
      ELSE 'quote_merged_into_another'
    END,
    CASE
      WHEN selected.quote_thread_id = v_survivor.quote_thread_id
        THEN 'Quotes merged'
      ELSE 'Quote number retired by merge'
    END,
    CASE
      WHEN selected.quote_thread_id = v_survivor.quote_thread_id
        THEN format(
          '%s live quotes merged using %s document handling. Retained %s; retired aliases: %s. This merge cannot be undone.',
          cardinality(p_quote_ids),
          p_merge_mode,
          v_canonical_reference,
          COALESCE(array_to_string(v_aliases, ', '), 'none')
        )
      ELSE format(
        '%s was permanently merged into %s. This merge cannot be undone.',
        selected.base_quote_reference,
        v_canonical_reference
      )
    END,
    p_actor_user_id,
    v_now
  FROM public.quotes AS selected
  WHERE selected.id = ANY(p_quote_ids);

  RETURN jsonb_build_object(
    'merge_group_id', v_group_id,
    'quote_id', v_new_quote_id,
    'quote_thread_id', v_survivor.quote_thread_id,
    'canonical_reference', v_canonical_reference,
    'aliases', COALESCE(to_jsonb(v_aliases), '[]'::JSONB),
    'merge_mode', p_merge_mode
  );
END;
$$;

REVOKE ALL ON FUNCTION public.merge_live_quotes(
  UUID[], UUID, TEXT, JSONB, JSONB, JSONB, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_live_quotes(
  UUID[], UUID, TEXT, JSONB, JSONB, JSONB, UUID
) TO service_role;

COMMENT ON TABLE public.quote_merge_groups IS
  'Permanent non-destructive live quote merge groups.';
COMMENT ON TABLE public.quote_reference_aliases IS
  'Retired live quote references that permanently resolve to a survivor.';
COMMENT ON TABLE public.quote_pdf_snapshots IS
  'Immutable quote PDFs captured before a live quote merge.';

NOTIFY pgrst, 'reload schema';

COMMIT;
