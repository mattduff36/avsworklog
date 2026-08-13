BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    JOIN pg_namespace ON pg_namespace.oid = pg_type.typnamespace
    WHERE pg_namespace.nspname = 'private'
      AND pg_type.typname = 'allocation_job'
  ) THEN
    CREATE TYPE private.allocation_job AS (
      source_type TEXT,
      source_id UUID,
      job_code TEXT,
      site_address TEXT,
      customer_name TEXT,
      title TEXT,
      address_valid BOOLEAN
    );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Source address fields and absence allocation policy
-- ---------------------------------------------------------------------------

ALTER TABLE public.quote_project_numbers
  ADD COLUMN IF NOT EXISTS site_address TEXT;

ALTER TABLE public.legacy_quotes
  ADD COLUMN IF NOT EXISTS site_address TEXT;

ALTER TABLE public.absence_reasons
  ADD COLUMN IF NOT EXISTS allocation_behaviour TEXT NOT NULL DEFAULT 'block';

ALTER TABLE public.absence_reasons
  DROP CONSTRAINT IF EXISTS absence_reasons_allocation_behaviour_check;

ALTER TABLE public.absence_reasons
  ADD CONSTRAINT absence_reasons_allocation_behaviour_check
  CHECK (allocation_behaviour IN ('block', 'reduce', 'ignore'));

-- ---------------------------------------------------------------------------
-- Plant inspection job identity
-- ---------------------------------------------------------------------------

ALTER TABLE public.plant_inspections
  ADD COLUMN IF NOT EXISTS job_source_type TEXT,
  ADD COLUMN IF NOT EXISTS job_source_id UUID,
  ADD COLUMN IF NOT EXISTS job_code TEXT,
  ADD COLUMN IF NOT EXISTS job_site_address TEXT;

ALTER TABLE public.plant_inspections
  DROP CONSTRAINT IF EXISTS plant_inspections_job_source_type_check;

ALTER TABLE public.plant_inspections
  ADD CONSTRAINT plant_inspections_job_source_type_check
  CHECK (
    job_source_type IS NULL
    OR job_source_type IN ('live_quote', 'legacy_quote', 'project_number')
  );

ALTER TABLE public.plant_inspections
  DROP CONSTRAINT IF EXISTS plant_inspections_job_identity_check;

ALTER TABLE public.plant_inspections
  ADD CONSTRAINT plant_inspections_job_identity_check
  CHECK (
    (
      job_source_type IS NULL
      AND job_source_id IS NULL
      AND job_code IS NULL
      AND job_site_address IS NULL
    )
    OR (
      job_source_type IS NOT NULL
      AND job_source_id IS NOT NULL
      AND NULLIF(BTRIM(job_code), '') IS NOT NULL
    )
  );

-- ---------------------------------------------------------------------------
-- Draft and publication tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.daily_labour_allocation_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_date DATE NOT NULL,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  job_source_type TEXT,
  job_source_id UUID,
  job_code TEXT,
  site_address TEXT,
  start_time TEXT,
  meeting_point TEXT,
  meet_person TEXT,
  notes TEXT,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT daily_labour_allocation_drafts_unique_profile_date UNIQUE (work_date, profile_id),
  CONSTRAINT daily_labour_allocation_drafts_job_source_type_check
    CHECK (job_source_type IS NULL OR job_source_type IN ('live_quote', 'legacy_quote', 'project_number')),
  CONSTRAINT daily_labour_allocation_drafts_job_identity_check
    CHECK (
      (
        job_source_type IS NULL
        AND job_source_id IS NULL
        AND job_code IS NULL
        AND site_address IS NULL
      )
      OR (
        job_source_type IS NOT NULL
        AND job_source_id IS NOT NULL
        AND NULLIF(BTRIM(job_code), '') IS NOT NULL
      )
    )
);

CREATE TABLE IF NOT EXISTS public.daily_plant_allocation_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_date DATE NOT NULL,
  plant_kind TEXT NOT NULL,
  plant_id UUID REFERENCES public.plant(id) ON DELETE CASCADE,
  hired_serial TEXT,
  hired_description TEXT,
  hired_company TEXT,
  hired_serial_normalized TEXT GENERATED ALWAYS AS (
    NULLIF(UPPER(BTRIM(regexp_replace(COALESCE(hired_serial, ''), '\s+', ' ', 'g'))), '')
  ) STORED,
  owner_team_id UUID REFERENCES public.org_teams(id) ON DELETE SET NULL,
  job_source_type TEXT,
  job_source_id UUID,
  job_code TEXT,
  site_address TEXT,
  notes TEXT,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT daily_plant_allocation_drafts_kind_check
    CHECK (plant_kind IN ('registered', 'hired')),
  CONSTRAINT daily_plant_allocation_drafts_shape_check
    CHECK (
      (
        plant_kind = 'registered'
        AND plant_id IS NOT NULL
        AND hired_serial IS NULL
        AND hired_description IS NULL
        AND hired_company IS NULL
      )
      OR (
        plant_kind = 'hired'
        AND plant_id IS NULL
        AND NULLIF(BTRIM(hired_serial), '') IS NOT NULL
        AND NULLIF(BTRIM(hired_description), '') IS NOT NULL
        AND NULLIF(BTRIM(hired_company), '') IS NOT NULL
      )
    ),
  CONSTRAINT daily_plant_allocation_drafts_job_source_type_check
    CHECK (job_source_type IS NULL OR job_source_type IN ('live_quote', 'legacy_quote', 'project_number')),
  CONSTRAINT daily_plant_allocation_drafts_job_identity_check
    CHECK (
      job_source_type IS NOT NULL
      AND job_source_id IS NOT NULL
      AND NULLIF(BTRIM(job_code), '') IS NOT NULL
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS daily_plant_allocation_drafts_registered_uniq
  ON public.daily_plant_allocation_drafts (work_date, plant_id)
  WHERE plant_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS daily_plant_allocation_drafts_hired_uniq
  ON public.daily_plant_allocation_drafts (work_date, hired_serial_normalized)
  WHERE plant_kind = 'hired';

CREATE TABLE IF NOT EXISTS public.daily_allocation_publications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_date DATE NOT NULL,
  revision_no INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  published_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scope_team_id UUID REFERENCES public.org_teams(id) ON DELETE SET NULL,
  scope_profile_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT daily_allocation_publications_revision_unique UNIQUE (work_date, revision_no),
  CONSTRAINT daily_allocation_publications_idempotency_unique UNIQUE (idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.daily_allocation_labour_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id UUID NOT NULL REFERENCES public.daily_allocation_publications(id) ON DELETE RESTRICT,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  availability TEXT NOT NULL,
  job_source_type TEXT,
  job_source_id UUID,
  job_code TEXT,
  site_address TEXT,
  customer_name TEXT,
  title TEXT,
  start_time TEXT,
  meeting_point TEXT,
  meet_person TEXT,
  notes TEXT,
  absence_id UUID,
  absence_reason_id UUID,
  absence_reason_name TEXT,
  absence_colour TEXT,
  absence_is_paid BOOLEAN,
  absence_is_half_day BOOLEAN,
  absence_half_day_session TEXT,
  absence_status TEXT,
  absence_allocation_behaviour TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT daily_allocation_labour_items_unique UNIQUE (publication_id, profile_id),
  CONSTRAINT daily_allocation_labour_items_availability_check
    CHECK (availability IN ('available', 'full_day_absence', 'half_day_absence')),
  CONSTRAINT daily_allocation_labour_items_work_or_absence_check
    CHECK (
      (
        availability = 'full_day_absence'
        AND job_code IS NULL
        AND NULLIF(BTRIM(COALESCE(absence_reason_name, '')), '') IS NOT NULL
      )
      OR (
        availability IN ('available', 'half_day_absence')
        AND NULLIF(BTRIM(COALESCE(job_code, '')), '') IS NOT NULL
        AND NULLIF(BTRIM(COALESCE(site_address, '')), '') IS NOT NULL
      )
    )
);

CREATE TABLE IF NOT EXISTS public.daily_allocation_plant_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id UUID NOT NULL REFERENCES public.daily_allocation_publications(id) ON DELETE RESTRICT,
  plant_kind TEXT NOT NULL,
  plant_id UUID REFERENCES public.plant(id) ON DELETE RESTRICT,
  hired_serial TEXT,
  hired_description TEXT,
  hired_company TEXT,
  hired_serial_normalized TEXT,
  owner_team_id UUID,
  job_source_type TEXT,
  job_source_id UUID,
  job_code TEXT NOT NULL,
  site_address TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT daily_allocation_plant_items_kind_check
    CHECK (plant_kind IN ('registered', 'hired'))
);

CREATE UNIQUE INDEX IF NOT EXISTS daily_allocation_plant_items_registered_uniq
  ON public.daily_allocation_plant_items (publication_id, plant_id)
  WHERE plant_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS daily_allocation_plant_items_hired_uniq
  ON public.daily_allocation_plant_items (publication_id, hired_serial_normalized)
  WHERE plant_kind = 'hired';

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS daily_allocation_labour_item_id UUID REFERENCES public.daily_allocation_labour_items(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS messages_daily_allocation_labour_item_uniq
  ON public.messages (daily_allocation_labour_item_id)
  WHERE daily_allocation_labour_item_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS message_recipients_message_user_uniq
  ON public.message_recipients (message_id, user_id);

DROP TRIGGER IF EXISTS set_updated_at_daily_labour_allocation_drafts ON public.daily_labour_allocation_drafts;
CREATE TRIGGER set_updated_at_daily_labour_allocation_drafts
  BEFORE UPDATE ON public.daily_labour_allocation_drafts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at_daily_plant_allocation_drafts ON public.daily_plant_allocation_drafts;
CREATE TRIGGER set_updated_at_daily_plant_allocation_drafts
  BEFORE UPDATE ON public.daily_plant_allocation_drafts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Authorization helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_actor_manage_daily_allocation(target_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_id UUID := auth.uid();
  actor_team_id UUID;
  target_team_id UUID;
BEGIN
  IF actor_id IS NULL OR target_profile_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF public.effective_module_access_level('daily-allocation') >= 5 THEN
    RETURN TRUE;
  END IF;

  IF NOT public.effective_has_module_level('daily-allocation', 4) THEN
    RETURN FALSE;
  END IF;

  SELECT team_id INTO actor_team_id FROM public.profiles WHERE id = actor_id;
  SELECT team_id INTO target_team_id FROM public.profiles WHERE id = target_profile_id;

  IF actor_team_id IS NOT NULL AND target_team_id IS NOT NULL AND actor_team_id = target_team_id THEN
    RETURN TRUE;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.profile_reporting_lines lines
    WHERE lines.profile_id = target_profile_id
      AND lines.manager_profile_id = actor_id
      AND lines.valid_to IS NULL
      AND lines.relation_type IN ('primary', 'secondary')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.can_actor_manage_daily_allocation_team(target_team_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_id UUID := auth.uid();
  actor_team_id UUID;
BEGIN
  IF actor_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF public.effective_module_access_level('daily-allocation') >= 5 THEN
    RETURN TRUE;
  END IF;

  IF NOT public.effective_has_module_level('daily-allocation', 4) THEN
    RETURN FALSE;
  END IF;

  SELECT team_id INTO actor_team_id FROM public.profiles WHERE id = actor_id;
  RETURN actor_team_id IS NOT NULL AND target_team_id IS NOT NULL AND actor_team_id = target_team_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_actor_view_daily_allocation(target_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND (
      target_profile_id = auth.uid()
      AND public.effective_has_module_level('daily-allocation', 2)
      OR public.can_actor_manage_daily_allocation(target_profile_id)
    );
$$;

REVOKE ALL ON FUNCTION public.can_actor_manage_daily_allocation(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_actor_manage_daily_allocation(UUID) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.can_actor_manage_daily_allocation_team(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_actor_manage_daily_allocation_team(UUID) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.can_actor_view_daily_allocation(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_actor_view_daily_allocation(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_daily_allocation_scope_profile_ids()
RETURNS UUID[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    ARRAY_AGG(profiles.id ORDER BY profiles.full_name, profiles.id),
    ARRAY[]::UUID[]
  )
  FROM public.profiles
  WHERE COALESCE(profiles.is_placeholder, FALSE) = FALSE
    AND NOT private.is_hidden_daily_allocation_profile(profiles.employee_id, profiles.full_name)
    AND public.can_actor_manage_daily_allocation(profiles.id);
$$;

REVOKE ALL ON FUNCTION public.list_daily_allocation_scope_profile_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_daily_allocation_scope_profile_ids() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Canonical job lookup used by triggers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.allocation_site_is_valid(p_site TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    p_site IS NOT NULL
    AND LENGTH(BTRIM(regexp_replace(p_site, '\s+', ' ', 'g'))) >= 8
    AND (
      ARRAY_LENGTH(regexp_split_to_array(BTRIM(p_site), E'\n+'), 1) >= 2
      OR ARRAY_LENGTH(regexp_split_to_array(BTRIM(regexp_replace(p_site, '\s+', ' ', 'g')), ' '), 1) >= 3
    );
$$;

CREATE OR REPLACE FUNCTION private.is_hidden_daily_allocation_profile(
  p_employee_id TEXT,
  p_full_name TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    COALESCE(p_employee_id, '') IN ('TS-ADM', 'TS-MGR', 'TS-EMP')
    OR (
      LOWER(BTRIM(COALESCE(p_full_name, ''))) = 'manager user'
      AND UPPER(BTRIM(COALESCE(p_employee_id, ''))) = 'MGR001'
    );
$$;

CREATE OR REPLACE FUNCTION private.allocation_quote_is_catalogue_eligible(
  p_is_latest BOOLEAN,
  p_commercial_status TEXT,
  p_status TEXT,
  p_customer_status TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    COALESCE(p_is_latest, FALSE)
    AND p_commercial_status = 'open'
    AND p_customer_status = 'active'
    AND p_status = ANY (ARRAY[
      'sent',
      'won',
      'ready_to_invoice',
      'po_received',
      'in_progress',
      'completed_part',
      'completed_full',
      'partially_invoiced',
      'invoiced'
    ]);
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
      COALESCE(NULLIF(BTRIM(quotes.base_quote_reference), ''), NULLIF(BTRIM(quotes.quote_reference), '')),
      NULLIF(BTRIM(quotes.site_address), ''),
      customers.company_name,
      COALESCE(NULLIF(BTRIM(quotes.subject_line), ''), NULLIF(BTRIM(quotes.project_description), '')),
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
      quote_project_numbers.project_reference,
      NULLIF(BTRIM(quote_project_numbers.site_address), ''),
      'Project number'::TEXT,
      COALESCE(NULLIF(BTRIM(quote_project_numbers.title), ''), NULLIF(BTRIM(quote_project_numbers.description), '')),
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
      legacy_quotes.quote_reference,
      NULLIF(BTRIM(legacy_quotes.site_address), ''),
      legacy_quotes.customer_name,
      legacy_quotes.title,
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
        COALESCE(NULLIF(BTRIM(quotes.base_quote_reference), ''), NULLIF(BTRIM(quotes.quote_reference), '')) AS job_code,
        NULLIF(BTRIM(quotes.site_address), '') AS site_address,
        customers.company_name AS customer_name,
        COALESCE(NULLIF(BTRIM(quotes.subject_line), ''), NULLIF(BTRIM(quotes.project_description), '')) AS title,
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

  IF p_require_valid AND NOT v_row.address_valid THEN
    RAISE EXCEPTION 'JOB_MISSING_SITE';
  END IF;

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- Draft guards
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.guard_daily_allocation_draft_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job private.allocation_job;
BEGIN
  IF public.view_as_role_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Daily allocation cannot be changed while viewing as another role';
  END IF;

  IF TG_TABLE_NAME = 'daily_labour_allocation_drafts' THEN
    IF TG_OP = 'DELETE' THEN
      IF NOT public.can_actor_manage_daily_allocation(OLD.profile_id) THEN
        RAISE EXCEPTION 'Not allowed to change this labour allocation';
      END IF;
      RETURN OLD;
    END IF;

    IF NOT public.can_actor_manage_daily_allocation(NEW.profile_id) THEN
      RAISE EXCEPTION 'Not allowed to change this labour allocation';
    END IF;

    IF NEW.job_source_type IS NOT NULL OR NEW.job_code IS NOT NULL THEN
      v_job := private.apply_allocation_job_fields(NEW.job_source_type, NEW.job_source_id, NEW.job_code, TRUE);
      NEW.job_source_type := v_job.source_type;
      NEW.job_source_id := v_job.source_id;
      NEW.job_code := v_job.job_code;
      NEW.site_address := v_job.site_address;
    ELSE
      NEW.job_source_type := NULL;
      NEW.job_source_id := NULL;
      NEW.job_code := NULL;
      NEW.site_address := NULL;
    END IF;

    IF TG_OP = 'UPDATE' THEN
      IF NEW.row_version <> OLD.row_version THEN
        RAISE EXCEPTION 'STALE_DRAFT_VERSION';
      END IF;
      NEW.row_version := OLD.row_version + 1;
      NEW.updated_by := auth.uid();
    ELSE
      NEW.created_by := COALESCE(NEW.created_by, auth.uid());
      NEW.updated_by := auth.uid();
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF NOT (
      public.can_actor_manage_daily_allocation_team(OLD.owner_team_id)
      OR public.effective_module_access_level('daily-allocation') >= 5
    ) THEN
      RAISE EXCEPTION 'Not allowed to change this plant allocation';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT team_id INTO NEW.owner_team_id FROM public.profiles WHERE id = auth.uid();
    IF NOT public.can_actor_manage_daily_allocation_team(NEW.owner_team_id)
      AND public.effective_module_access_level('daily-allocation') < 5 THEN
      RAISE EXCEPTION 'Not allowed to allocate plant';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF public.effective_module_access_level('daily-allocation') < 5
      AND NOT public.can_actor_manage_daily_allocation_team(OLD.owner_team_id) THEN
      RAISE EXCEPTION 'Not allowed to change this plant allocation';
    END IF;
    IF public.effective_module_access_level('daily-allocation') < 5 THEN
      NEW.owner_team_id := OLD.owner_team_id;
    END IF;
    IF NEW.row_version <> OLD.row_version THEN
      RAISE EXCEPTION 'STALE_DRAFT_VERSION';
    END IF;
    NEW.row_version := OLD.row_version + 1;
  END IF;

  v_job := private.apply_allocation_job_fields(NEW.job_source_type, NEW.job_source_id, NEW.job_code, TRUE);
  NEW.job_source_type := v_job.source_type;
  NEW.job_source_id := v_job.source_id;
  NEW.job_code := v_job.job_code;
  NEW.site_address := v_job.site_address;
  NEW.updated_by := auth.uid();
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := COALESCE(NEW.created_by, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS daily_labour_allocation_drafts_guard ON public.daily_labour_allocation_drafts;
CREATE TRIGGER daily_labour_allocation_drafts_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.daily_labour_allocation_drafts
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_daily_allocation_draft_write();

DROP TRIGGER IF EXISTS daily_plant_allocation_drafts_guard ON public.daily_plant_allocation_drafts;
CREATE TRIGGER daily_plant_allocation_drafts_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.daily_plant_allocation_drafts
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_daily_allocation_draft_write();

-- ---------------------------------------------------------------------------
-- Plant inspection job overwrite
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.guard_plant_inspection_job_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job private.allocation_job;
BEGIN
  IF NEW.job_source_type IS NULL AND NEW.job_source_id IS NULL AND NULLIF(BTRIM(COALESCE(NEW.job_code, '')), '') IS NULL THEN
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

  v_job := private.apply_allocation_job_fields(
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

DROP TRIGGER IF EXISTS plant_inspections_job_guard ON public.plant_inspections;
CREATE TRIGGER plant_inspections_job_guard
  BEFORE INSERT OR UPDATE ON public.plant_inspections
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_plant_inspection_job_fields();

-- ---------------------------------------------------------------------------
-- Publication immutability and atomic publish
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.guard_daily_allocation_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'Published daily allocation records cannot be changed';
END;
$$;

DROP TRIGGER IF EXISTS daily_allocation_publications_immutable ON public.daily_allocation_publications;
CREATE TRIGGER daily_allocation_publications_immutable
  BEFORE UPDATE OR DELETE ON public.daily_allocation_publications
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_daily_allocation_immutable();

DROP TRIGGER IF EXISTS daily_allocation_labour_items_immutable ON public.daily_allocation_labour_items;
CREATE TRIGGER daily_allocation_labour_items_immutable
  BEFORE UPDATE OR DELETE ON public.daily_allocation_labour_items
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_daily_allocation_immutable();

DROP TRIGGER IF EXISTS daily_allocation_plant_items_immutable ON public.daily_allocation_plant_items;
CREATE TRIGGER daily_allocation_plant_items_immutable
  BEFORE UPDATE OR DELETE ON public.daily_allocation_plant_items
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_daily_allocation_immutable();

CREATE OR REPLACE FUNCTION private.prepare_daily_allocation_publication()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_id UUID := auth.uid();
  actor_team_id UUID;
  next_revision INTEGER;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF public.view_as_role_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Daily allocation cannot be published while viewing as another role';
  END IF;
  IF NOT public.effective_has_module_level('daily-allocation', 4) THEN
    RAISE EXCEPTION 'Manager-level daily allocation access is required to publish';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(NEW.work_date::TEXT)::bigint);

  SELECT team_id INTO actor_team_id FROM public.profiles WHERE id = actor_id;

  SELECT COALESCE(MAX(revision_no), 0) + 1
  INTO next_revision
  FROM public.daily_allocation_publications
  WHERE work_date = NEW.work_date;

  NEW.id := COALESCE(NEW.id, gen_random_uuid());
  NEW.revision_no := next_revision;
  NEW.published_by := actor_id;
  NEW.published_at := NOW();
  NEW.scope_team_id := actor_team_id;
  NEW.idempotency_key := NULLIF(BTRIM(NEW.idempotency_key), '');
  IF NEW.idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Idempotency key is required';
  END IF;

  SELECT COALESCE(ARRAY_AGG(profiles.id), ARRAY[]::UUID[])
  INTO NEW.scope_profile_ids
  FROM public.profiles
  WHERE public.can_actor_manage_daily_allocation(profiles.id)
    AND COALESCE(profiles.is_placeholder, FALSE) = FALSE
    AND NOT private.is_hidden_daily_allocation_profile(profiles.employee_id, profiles.full_name);

  IF NEW.scope_profile_ids IS NULL OR ARRAY_LENGTH(NEW.scope_profile_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'No employees are in scope for this publication';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.finish_daily_allocation_publication()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  profile_row RECORD;
  absence_row RECORD;
  draft_row RECORD;
  plant_row RECORD;
  job_row private.allocation_job;
  labour_item_id UUID;
  message_id UUID;
  availability TEXT;
  body TEXT;
BEGIN
  FOR profile_row IN
    SELECT
      profiles.id,
      profiles.full_name
    FROM public.profiles
    WHERE profiles.id = ANY (NEW.scope_profile_ids)
  LOOP
    absence_row := NULL;
    draft_row := NULL;
    job_row := NULL;
    SELECT
      absences.id,
      absences.reason_id,
      absence_reasons.name,
      absence_reasons.color,
      absence_reasons.is_paid,
      absence_reasons.allocation_behaviour,
      absences.is_half_day,
      absences.half_day_session,
      absences.status
    INTO absence_row
    FROM public.absences
    JOIN public.absence_reasons ON absence_reasons.id = absences.reason_id
    WHERE absences.profile_id = profile_row.id
      AND absences.status IN ('approved', 'processed')
      AND absence_reasons.allocation_behaviour IN ('block', 'reduce')
      AND NEW.work_date >= absences.date
      AND NEW.work_date <= COALESCE(absences.end_date, absences.date)
    ORDER BY absences.is_half_day ASC, absences.created_at DESC
    LIMIT 1;

    availability := 'available';
    IF absence_row.id IS NOT NULL THEN
      IF absence_row.allocation_behaviour = 'block'
        OR NOT COALESCE(absence_row.is_half_day, FALSE) THEN
        availability := 'full_day_absence';
      ELSE
        availability := 'half_day_absence';
      END IF;
    END IF;

    draft_row := NULL;
    SELECT * INTO draft_row
    FROM public.daily_labour_allocation_drafts
    WHERE work_date = NEW.work_date
      AND profile_id = profile_row.id;

    IF availability <> 'full_day_absence' THEN
      IF draft_row.id IS NULL THEN
        RAISE EXCEPTION 'PUBLISH_INCOMPLETE';
      END IF;
      job_row := private.apply_allocation_job_fields(
        draft_row.job_source_type,
        draft_row.job_source_id,
        draft_row.job_code,
        TRUE
      );
    ELSE
      job_row := NULL;
    END IF;

    labour_item_id := gen_random_uuid();
    INSERT INTO public.daily_allocation_labour_items (
      id,
      publication_id,
      profile_id,
      availability,
      job_source_type,
      job_source_id,
      job_code,
      site_address,
      customer_name,
      title,
      start_time,
      meeting_point,
      meet_person,
      notes,
      absence_id,
      absence_reason_id,
      absence_reason_name,
      absence_colour,
      absence_is_paid,
      absence_is_half_day,
      absence_half_day_session,
      absence_status,
      absence_allocation_behaviour
    ) VALUES (
      labour_item_id,
      NEW.id,
      profile_row.id,
      availability,
      CASE WHEN availability = 'full_day_absence' THEN NULL ELSE job_row.source_type END,
      CASE WHEN availability = 'full_day_absence' THEN NULL ELSE job_row.source_id END,
      CASE WHEN availability = 'full_day_absence' THEN NULL ELSE job_row.job_code END,
      CASE WHEN availability = 'full_day_absence' THEN NULL ELSE job_row.site_address END,
      CASE WHEN availability = 'full_day_absence' THEN NULL ELSE job_row.customer_name END,
      CASE WHEN availability = 'full_day_absence' THEN NULL ELSE job_row.title END,
      CASE WHEN availability = 'full_day_absence' THEN NULL ELSE draft_row.start_time END,
      CASE WHEN availability = 'full_day_absence' THEN NULL ELSE draft_row.meeting_point END,
      CASE WHEN availability = 'full_day_absence' THEN NULL ELSE draft_row.meet_person END,
      CASE WHEN availability = 'full_day_absence' THEN NULL ELSE draft_row.notes END,
      absence_row.id,
      absence_row.reason_id,
      absence_row.name,
      absence_row.color,
      absence_row.is_paid,
      absence_row.is_half_day,
      absence_row.half_day_session,
      absence_row.status,
      absence_row.allocation_behaviour
    );

    IF availability = 'full_day_absence' THEN
      body := format(
        'You are recorded as %s on %s. Do not attend site unless your manager contacts you.',
        COALESCE(absence_row.name, 'leave'),
        NEW.work_date::TEXT
      );
    ELSE
      body := format(
        'Allocation for %s%sJob code: %s%sSite: %s%sStart: %s%sMeeting point: %s%sMeet: %s%s%s',
        NEW.work_date::TEXT,
        E'\n',
        job_row.job_code,
        E'\n',
        job_row.site_address,
        E'\n',
        COALESCE(NULLIF(BTRIM(draft_row.start_time), ''), 'as instructed'),
        E'\n',
        COALESCE(NULLIF(BTRIM(draft_row.meeting_point), ''), 'as instructed'),
        E'\n',
        COALESCE(NULLIF(BTRIM(draft_row.meet_person), ''), 'as instructed'),
        E'\n',
        COALESCE(NULLIF(BTRIM(draft_row.notes), ''), '')
      );
    END IF;

    INSERT INTO public.messages (
      type,
      subject,
      body,
      priority,
      sender_id,
      created_via,
      module_key,
      daily_allocation_labour_item_id
    ) VALUES (
      'NOTIFICATION',
      format('Your allocation for %s', NEW.work_date::TEXT),
      body,
      'LOW',
      NEW.published_by,
      'daily_allocation_publish',
      'daily_allocation',
      labour_item_id
    ) RETURNING id INTO message_id;

    INSERT INTO public.message_recipients (message_id, user_id, status)
    VALUES (message_id, profile_row.id, 'PENDING');
  END LOOP;

  FOR plant_row IN
    SELECT *
    FROM public.daily_plant_allocation_drafts
    WHERE work_date = NEW.work_date
      AND (
        public.effective_module_access_level('daily-allocation') >= 5
        OR public.can_actor_manage_daily_allocation_team(owner_team_id)
      )
  LOOP
    job_row := private.apply_allocation_job_fields(
      plant_row.job_source_type,
      plant_row.job_source_id,
      plant_row.job_code,
      TRUE
    );
    INSERT INTO public.daily_allocation_plant_items (
      publication_id,
      plant_kind,
      plant_id,
      hired_serial,
      hired_description,
      hired_company,
      hired_serial_normalized,
      owner_team_id,
      job_source_type,
      job_source_id,
      job_code,
      site_address,
      notes
    ) VALUES (
      NEW.id,
      plant_row.plant_kind,
      plant_row.plant_id,
      plant_row.hired_serial,
      plant_row.hired_description,
      plant_row.hired_company,
      plant_row.hired_serial_normalized,
      plant_row.owner_team_id,
      job_row.source_type,
      job_row.source_id,
      job_row.job_code,
      job_row.site_address,
      plant_row.notes
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS daily_allocation_publications_prepare ON public.daily_allocation_publications;
CREATE TRIGGER daily_allocation_publications_prepare
  BEFORE INSERT ON public.daily_allocation_publications
  FOR EACH ROW
  EXECUTE FUNCTION private.prepare_daily_allocation_publication();

DROP TRIGGER IF EXISTS daily_allocation_publications_finish ON public.daily_allocation_publications;
CREATE TRIGGER daily_allocation_publications_finish
  AFTER INSERT ON public.daily_allocation_publications
  FOR EACH ROW
  EXECUTE FUNCTION private.finish_daily_allocation_publication();

CREATE OR REPLACE FUNCTION private.guard_daily_allocation_message_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.daily_allocation_labour_item_id IS NOT NULL THEN
      RAISE EXCEPTION 'Published allocation messages cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.daily_allocation_labour_item_id IS NOT NULL THEN
    IF NEW.subject IS DISTINCT FROM OLD.subject
      OR NEW.body IS DISTINCT FROM OLD.body
      OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
      OR NEW.module_key IS DISTINCT FROM OLD.module_key
      OR NEW.daily_allocation_labour_item_id IS DISTINCT FROM OLD.daily_allocation_labour_item_id
      OR NEW.type IS DISTINCT FROM OLD.type
      OR NEW.priority IS DISTINCT FROM OLD.priority
      OR NEW.sender_id IS DISTINCT FROM OLD.sender_id
      OR NEW.created_via IS DISTINCT FROM OLD.created_via THEN
      RAISE EXCEPTION 'Published allocation messages cannot be changed';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_daily_allocation_guard ON public.messages;
CREATE TRIGGER messages_daily_allocation_guard
  BEFORE UPDATE OR DELETE ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_daily_allocation_message_mutation();

CREATE OR REPLACE FUNCTION private.guard_daily_allocation_recipient_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  labour_profile_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (
      SELECT 1
      FROM public.messages
      WHERE messages.id = OLD.message_id
        AND messages.daily_allocation_labour_item_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Published allocation message recipients cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  SELECT labour_items.profile_id
  INTO labour_profile_id
  FROM public.messages
  JOIN public.daily_allocation_labour_items labour_items
    ON labour_items.id = messages.daily_allocation_labour_item_id
  WHERE messages.id = COALESCE(NEW.message_id, OLD.message_id)
    AND messages.daily_allocation_labour_item_id IS NOT NULL;

  IF labour_profile_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.user_id IS DISTINCT FROM labour_profile_id THEN
      RAISE EXCEPTION 'Published allocation message recipients cannot be redirected';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.message_id IS DISTINCT FROM OLD.message_id
    OR NEW.user_id IS DISTINCT FROM labour_profile_id THEN
    RAISE EXCEPTION 'Published allocation message recipients cannot be redirected';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS message_recipients_daily_allocation_guard ON public.message_recipients;
CREATE TRIGGER message_recipients_daily_allocation_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.message_recipients
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_daily_allocation_recipient_mutation();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.daily_labour_allocation_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_plant_allocation_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_allocation_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_allocation_labour_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_allocation_plant_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_labour_allocation_drafts_select ON public.daily_labour_allocation_drafts;
CREATE POLICY daily_labour_allocation_drafts_select ON public.daily_labour_allocation_drafts
  FOR SELECT TO authenticated
  USING (public.can_actor_manage_daily_allocation(profile_id));

DROP POLICY IF EXISTS daily_labour_allocation_drafts_write ON public.daily_labour_allocation_drafts;
CREATE POLICY daily_labour_allocation_drafts_write ON public.daily_labour_allocation_drafts
  FOR ALL TO authenticated
  USING (public.can_actor_manage_daily_allocation(profile_id))
  WITH CHECK (public.can_actor_manage_daily_allocation(profile_id));

DROP POLICY IF EXISTS daily_plant_allocation_drafts_select ON public.daily_plant_allocation_drafts;
CREATE POLICY daily_plant_allocation_drafts_select ON public.daily_plant_allocation_drafts
  FOR SELECT TO authenticated
  USING (
    public.effective_has_module_level('daily-allocation', 4)
    AND (
      public.effective_module_access_level('daily-allocation') >= 5
      OR public.can_actor_manage_daily_allocation_team(owner_team_id)
    )
  );

DROP POLICY IF EXISTS daily_plant_allocation_drafts_write ON public.daily_plant_allocation_drafts;
CREATE POLICY daily_plant_allocation_drafts_write ON public.daily_plant_allocation_drafts
  FOR ALL TO authenticated
  USING (
    public.effective_has_module_level('daily-allocation', 4)
    AND (
      public.effective_module_access_level('daily-allocation') >= 5
      OR public.can_actor_manage_daily_allocation_team(owner_team_id)
    )
  )
  WITH CHECK (
    public.effective_has_module_level('daily-allocation', 4)
    AND (
      public.effective_module_access_level('daily-allocation') >= 5
      OR public.can_actor_manage_daily_allocation_team(owner_team_id)
    )
  );

DROP POLICY IF EXISTS daily_allocation_publications_select ON public.daily_allocation_publications;
CREATE POLICY daily_allocation_publications_select ON public.daily_allocation_publications
  FOR SELECT TO authenticated
  USING (
    public.effective_module_access_level('daily-allocation') >= 5
    OR (
      public.effective_has_module_level('daily-allocation', 4)
      AND (
        public.can_actor_manage_daily_allocation_team(scope_team_id)
        OR published_by = auth.uid()
        OR auth.uid() = ANY (scope_profile_ids)
      )
    )
    OR EXISTS (
      SELECT 1
      FROM public.daily_allocation_labour_items items
      WHERE items.publication_id = daily_allocation_publications.id
        AND items.profile_id = auth.uid()
        AND public.effective_has_module_level('daily-allocation', 2)
    )
    OR EXISTS (
      SELECT 1
      FROM public.daily_allocation_labour_items items
      WHERE items.publication_id = daily_allocation_publications.id
        AND public.can_actor_manage_daily_allocation(items.profile_id)
    )
  );

DROP POLICY IF EXISTS daily_allocation_publications_insert ON public.daily_allocation_publications;
CREATE POLICY daily_allocation_publications_insert ON public.daily_allocation_publications
  FOR INSERT TO authenticated
  WITH CHECK (public.effective_has_module_level('daily-allocation', 4));

DROP POLICY IF EXISTS daily_allocation_labour_items_select ON public.daily_allocation_labour_items;
CREATE POLICY daily_allocation_labour_items_select ON public.daily_allocation_labour_items
  FOR SELECT TO authenticated
  USING (public.can_actor_view_daily_allocation(profile_id));

DROP POLICY IF EXISTS daily_allocation_plant_items_select ON public.daily_allocation_plant_items;
CREATE POLICY daily_allocation_plant_items_select ON public.daily_allocation_plant_items
  FOR SELECT TO authenticated
  USING (
    public.effective_module_access_level('daily-allocation') >= 5
    OR EXISTS (
      SELECT 1
      FROM public.daily_allocation_publications publications
      WHERE publications.id = daily_allocation_plant_items.publication_id
        AND (
          public.can_actor_manage_daily_allocation_team(publications.scope_team_id)
          OR publications.published_by = auth.uid()
        )
        AND public.effective_has_module_level('daily-allocation', 4)
    )
    OR EXISTS (
      SELECT 1
      FROM public.daily_allocation_labour_items items
      WHERE items.publication_id = daily_allocation_plant_items.publication_id
        AND public.can_actor_manage_daily_allocation(items.profile_id)
    )
  );

CREATE OR REPLACE FUNCTION public.list_daily_allocation_plant_conflicts(p_work_date DATE)
RETURNS TABLE (
  plant_id UUID,
  hired_serial TEXT,
  owner_team_id UUID
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    drafts.plant_id,
    drafts.hired_serial,
    drafts.owner_team_id
  FROM public.daily_plant_allocation_drafts drafts
  WHERE drafts.work_date = p_work_date
    AND public.effective_has_module_level('daily-allocation', 4)
    AND NOT (
      public.effective_module_access_level('daily-allocation') >= 5
      OR public.can_actor_manage_daily_allocation_team(drafts.owner_team_id)
    );
$$;

REVOKE ALL ON FUNCTION public.list_daily_allocation_plant_conflicts(DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_daily_allocation_plant_conflicts(DATE) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Notification / message module keys
-- ---------------------------------------------------------------------------

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_module_key_check;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_module_key_check
  CHECK (
    module_key IN (
      'errors',
      'maintenance',
      'rams',
      'approvals',
      'inspections',
      'absence',
      'timesheets',
      'inventory',
      'processed_absence',
      'training',
      'suggestions',
      'toolbox_talks',
      'reminders',
      'quotes',
      'general_notifications',
      'sensitive_pin_security',
      'daily_allocation'
    )
  );

ALTER TABLE public.notification_preferences
  DROP CONSTRAINT IF EXISTS notification_preferences_module_key_check;

ALTER TABLE public.notification_preferences
  ADD CONSTRAINT notification_preferences_module_key_check
  CHECK (
    module_key IN (
      'errors',
      'maintenance',
      'rams',
      'approvals',
      'inspections',
      'absence',
      'timesheets',
      'inventory',
      'processed_absence',
      'training',
      'suggestions',
      'toolbox_talks',
      'reminders',
      'quotes',
      'general_notifications',
      'sensitive_pin_security',
      'daily_allocation'
    )
  );

-- ---------------------------------------------------------------------------
-- Permission module seed
-- ---------------------------------------------------------------------------

INSERT INTO public.permission_modules (module_name, minimum_role_id, sort_order, access_mode)
SELECT 'daily-allocation', roles.id, 206, 'team'
FROM public.roles
WHERE roles.name = 'contractor'
ON CONFLICT (module_name) DO UPDATE
SET minimum_role_id = EXCLUDED.minimum_role_id,
    sort_order = EXCLUDED.sort_order,
    access_mode = EXCLUDED.access_mode,
    updated_at = NOW();

INSERT INTO public.role_permissions (role_id, module_name, enabled)
SELECT roles.id, 'daily-allocation', FALSE
FROM public.roles
ON CONFLICT (role_id, module_name) DO NOTHING;

INSERT INTO public.team_module_permissions (team_id, module_name, enabled)
SELECT org_teams.id, 'daily-allocation', TRUE
FROM public.org_teams
WHERE org_teams.active = TRUE
ON CONFLICT (team_id, module_name) DO UPDATE
SET enabled = EXCLUDED.enabled,
    updated_at = NOW();

COMMIT;
