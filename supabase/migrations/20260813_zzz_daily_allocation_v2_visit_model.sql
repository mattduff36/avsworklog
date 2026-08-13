-- finalise-phase: predeploy
-- DA2-7F3C phase 1: additive v2 plan-day / visit / publication snapshot model.
-- Preserve every v1 table, row, and publication hash. Never infer historical
-- end times. Never dual-write. v2 remains gated closed until a later checkpoint.
BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
SET LOCAL search_path = public, extensions, pg_catalog;

-- ---------------------------------------------------------------------------
-- DA2-MIG-001 / DA2-ROLL-001: v2 remains inaccessible until explicitly enabled
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS private.daily_allocation_v2_runtime (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  board_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  writes_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO private.daily_allocation_v2_runtime (singleton, board_enabled, writes_enabled)
VALUES (TRUE, FALSE, FALSE)
ON CONFLICT (singleton) DO NOTHING;

CREATE OR REPLACE FUNCTION private.daily_allocation_v2_writes_allowed()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (
      SELECT runtime.writes_enabled
      FROM private.daily_allocation_v2_runtime runtime
      WHERE runtime.singleton = TRUE
    ),
    FALSE
  );
$$;

CREATE OR REPLACE FUNCTION private.daily_allocation_london_date(p_at TIMESTAMPTZ)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT (p_at AT TIME ZONE 'Europe/London')::DATE;
$$;

CREATE OR REPLACE FUNCTION private.daily_allocation_london_clock_is_grid(p_at TIMESTAMPTZ)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    p_at IS NOT NULL
    AND EXTRACT(SECOND FROM (p_at AT TIME ZONE 'Europe/London')) = 0
    AND (EXTRACT(MINUTE FROM (p_at AT TIME ZONE 'Europe/London'))::INTEGER % 30) = 0;
$$;

CREATE OR REPLACE FUNCTION private.daily_allocation_interval_is_valid(
  p_work_date DATE,
  p_starts_at TIMESTAMPTZ,
  p_ends_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    p_work_date IS NOT NULL
    AND p_starts_at IS NOT NULL
    AND p_ends_at IS NOT NULL
    AND p_ends_at > p_starts_at
    AND p_ends_at >= p_starts_at + INTERVAL '30 minutes'
    AND p_work_date = private.daily_allocation_london_date(p_starts_at)
    AND private.daily_allocation_london_date(p_starts_at)
      = private.daily_allocation_london_date(p_ends_at)
    AND private.daily_allocation_london_clock_is_grid(p_starts_at)
    AND private.daily_allocation_london_clock_is_grid(p_ends_at);
$$;

CREATE OR REPLACE FUNCTION public.get_daily_allocation_v2_runtime()
RETURNS TABLE (board_enabled BOOLEAN, writes_enabled BOOLEAN)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF NOT public.effective_has_module_level('daily-allocation', 2) THEN
    RAISE EXCEPTION 'Daily allocation access required';
  END IF;
  RETURN QUERY
  SELECT
    COALESCE(runtime.board_enabled, FALSE),
    COALESCE(runtime.writes_enabled, FALSE)
  FROM private.daily_allocation_v2_runtime runtime
  WHERE runtime.singleton = TRUE
  UNION ALL
  SELECT FALSE, FALSE
  WHERE NOT EXISTS (
    SELECT 1
    FROM private.daily_allocation_v2_runtime runtime
    WHERE runtime.singleton = TRUE
  )
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_daily_allocation_v2_runtime() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_daily_allocation_v2_runtime() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Additive publication columns (v1 rows keep snapshot_version = 1)
-- ---------------------------------------------------------------------------

ALTER TABLE public.daily_allocation_publications
  ADD COLUMN IF NOT EXISTS snapshot_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.daily_allocation_publications
  DROP CONSTRAINT IF EXISTS daily_allocation_publications_snapshot_version_check;

ALTER TABLE public.daily_allocation_publications
  ADD CONSTRAINT daily_allocation_publications_snapshot_version_check
  CHECK (snapshot_version IN (1, 2));

ALTER TABLE public.daily_allocation_publications
  ADD COLUMN IF NOT EXISTS plan_day_id UUID;

ALTER TABLE public.daily_allocation_publications
  ADD COLUMN IF NOT EXISTS published_plan_version INTEGER;

ALTER TABLE public.daily_allocation_publications
  ADD COLUMN IF NOT EXISTS confirm_unallocated BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.daily_allocation_publications
  ADD COLUMN IF NOT EXISTS snapshot_fingerprint TEXT;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS daily_allocation_publication_id UUID
    REFERENCES public.daily_allocation_publications(id) ON DELETE RESTRICT;

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_daily_allocation_link_exclusive_check;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_daily_allocation_link_exclusive_check
  CHECK (
    daily_allocation_labour_item_id IS NULL
    OR daily_allocation_publication_id IS NULL
  );

-- ---------------------------------------------------------------------------
-- v2 planning tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.daily_allocation_plan_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_date DATE NOT NULL,
  team_id TEXT NOT NULL REFERENCES public.org_teams(id) ON DELETE RESTRICT,
  plan_version INTEGER NOT NULL DEFAULT 1,
  converted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  converted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT daily_allocation_plan_days_version_check CHECK (plan_version >= 1),
  CONSTRAINT daily_allocation_plan_days_unique UNIQUE (work_date, team_id)
);

CREATE TABLE IF NOT EXISTS public.daily_allocation_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_day_id UUID NOT NULL REFERENCES public.daily_allocation_plan_days(id) ON DELETE RESTRICT,
  work_date DATE NOT NULL,
  owner_team_id TEXT NOT NULL REFERENCES public.org_teams(id) ON DELETE RESTRICT,
  job_source_type TEXT NOT NULL,
  job_source_id UUID NOT NULL,
  job_code TEXT NOT NULL,
  site_address TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  meeting_point TEXT,
  meet_person TEXT,
  notes TEXT,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT daily_allocation_visits_job_source_type_check
    CHECK (job_source_type IN ('live_quote', 'legacy_quote', 'project_number')),
  CONSTRAINT daily_allocation_visits_job_identity_check
    CHECK (NULLIF(BTRIM(job_code), '') IS NOT NULL AND NULLIF(BTRIM(site_address), '') IS NOT NULL),
  CONSTRAINT daily_allocation_visits_time_order_check CHECK (ends_at > starts_at),
  CONSTRAINT daily_allocation_visits_min_duration_check
    CHECK (ends_at >= starts_at + INTERVAL '30 minutes'),
  CONSTRAINT daily_allocation_visits_london_same_day_check CHECK (
    work_date = (starts_at AT TIME ZONE 'Europe/London')::DATE
    AND (starts_at AT TIME ZONE 'Europe/London')::DATE
      = (ends_at AT TIME ZONE 'Europe/London')::DATE
  )
);

CREATE INDEX IF NOT EXISTS daily_allocation_visits_plan_day_idx
  ON public.daily_allocation_visits (plan_day_id, starts_at, ends_at);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'daily_allocation_visits_trusted_grid_check'
  ) THEN
    ALTER TABLE public.daily_allocation_visits
      ADD CONSTRAINT daily_allocation_visits_trusted_grid_check
      CHECK (private.daily_allocation_interval_is_valid(work_date, starts_at, ends_at));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.daily_allocation_visit_labour (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID NOT NULL REFERENCES public.daily_allocation_visits(id) ON DELETE CASCADE,
  plan_day_id UUID NOT NULL REFERENCES public.daily_allocation_plan_days(id) ON DELETE RESTRICT,
  work_date DATE NOT NULL,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  meeting_point TEXT,
  meet_person TEXT,
  notes TEXT,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT daily_allocation_visit_labour_unique UNIQUE (visit_id, profile_id),
  CONSTRAINT daily_allocation_visit_labour_time_order_check CHECK (ends_at > starts_at),
  CONSTRAINT daily_allocation_visit_labour_half_open_min_check
    CHECK (ends_at >= starts_at + INTERVAL '30 minutes')
);

CREATE INDEX IF NOT EXISTS daily_allocation_visit_labour_profile_idx
  ON public.daily_allocation_visit_labour (profile_id, work_date, starts_at);

CREATE TABLE IF NOT EXISTS public.daily_allocation_visit_plant (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID NOT NULL REFERENCES public.daily_allocation_visits(id) ON DELETE CASCADE,
  plan_day_id UUID NOT NULL REFERENCES public.daily_allocation_plan_days(id) ON DELETE RESTRICT,
  work_date DATE NOT NULL,
  plant_kind TEXT NOT NULL,
  plant_id UUID REFERENCES public.plant(id) ON DELETE CASCADE,
  hired_serial TEXT,
  hired_description TEXT,
  hired_company TEXT,
  hired_serial_normalized TEXT GENERATED ALWAYS AS (
    NULLIF(UPPER(BTRIM(regexp_replace(COALESCE(hired_serial, ''), '\s+', ' ', 'g'))), '')
  ) STORED,
  hired_company_normalized TEXT GENERATED ALWAYS AS (
    NULLIF(UPPER(BTRIM(regexp_replace(COALESCE(hired_company, ''), '\s+', ' ', 'g'))), '')
  ) STORED,
  owner_team_id TEXT REFERENCES public.org_teams(id) ON DELETE SET NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  notes TEXT,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT daily_allocation_visit_plant_kind_check
    CHECK (plant_kind IN ('registered', 'hired')),
  CONSTRAINT daily_allocation_visit_plant_shape_check
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
  CONSTRAINT daily_allocation_visit_plant_time_order_check CHECK (ends_at > starts_at),
  CONSTRAINT daily_allocation_visit_plant_half_open_min_check
    CHECK (ends_at >= starts_at + INTERVAL '30 minutes')
);

CREATE UNIQUE INDEX IF NOT EXISTS daily_allocation_visit_plant_registered_uniq
  ON public.daily_allocation_visit_plant (visit_id, plant_id)
  WHERE plant_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS daily_allocation_visit_plant_hired_uniq
  ON public.daily_allocation_visit_plant (visit_id, hired_serial_normalized, hired_company_normalized)
  WHERE plant_kind = 'hired';

CREATE TABLE IF NOT EXISTS public.daily_allocation_conflict_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_day_id UUID NOT NULL REFERENCES public.daily_allocation_plan_days(id) ON DELETE CASCADE,
  visit_id UUID REFERENCES public.daily_allocation_visits(id) ON DELETE CASCADE,
  profile_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  plant_id UUID REFERENCES public.plant(id) ON DELETE CASCADE,
  conflict_kind TEXT NOT NULL,
  conflict_signature TEXT,
  evidence TEXT NOT NULL,
  confirmed_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT daily_allocation_conflict_overrides_kind_check
    CHECK (conflict_kind IN ('pending_absence', 'off_shift')),
  CONSTRAINT daily_allocation_conflict_overrides_evidence_check
    CHECK (NULLIF(BTRIM(evidence), '') IS NOT NULL)
);

ALTER TABLE public.daily_allocation_conflict_overrides
  ADD COLUMN IF NOT EXISTS conflict_signature TEXT;

CREATE TABLE IF NOT EXISTS private.daily_allocation_plant_day_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_date DATE NOT NULL,
  plant_kind TEXT NOT NULL,
  plant_id UUID,
  hired_serial_normalized TEXT,
  hired_company_normalized TEXT,
  job_source_type TEXT NOT NULL,
  job_source_id UUID NOT NULL,
  job_code TEXT NOT NULL,
  ref_count INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT daily_allocation_plant_day_jobs_kind_check
    CHECK (plant_kind IN ('registered', 'hired')),
  CONSTRAINT daily_allocation_plant_day_jobs_ref_check CHECK (ref_count >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS daily_allocation_plant_day_jobs_registered_uniq
  ON private.daily_allocation_plant_day_jobs (work_date, plant_id)
  WHERE plant_kind = 'registered' AND plant_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS daily_allocation_plant_day_jobs_hired_uniq
  ON private.daily_allocation_plant_day_jobs (
    work_date,
    hired_serial_normalized,
    hired_company_normalized
  )
  WHERE plant_kind = 'hired';

-- ---------------------------------------------------------------------------
-- Immutable v2 snapshots
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.daily_allocation_published_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id UUID NOT NULL REFERENCES public.daily_allocation_publications(id) ON DELETE RESTRICT,
  source_visit_id UUID,
  sequence_no INTEGER NOT NULL,
  work_date DATE NOT NULL,
  owner_team_id TEXT,
  job_source_type TEXT NOT NULL,
  job_source_id UUID NOT NULL,
  job_code TEXT NOT NULL,
  site_address TEXT NOT NULL,
  customer_name TEXT,
  title TEXT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  meeting_point TEXT,
  meet_person TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT daily_allocation_published_visits_sequence_check CHECK (sequence_no > 0),
  CONSTRAINT daily_allocation_published_visits_time_order_check CHECK (ends_at > starts_at),
  CONSTRAINT daily_allocation_published_visits_unique_sequence
    UNIQUE (publication_id, sequence_no)
);

CREATE UNIQUE INDEX IF NOT EXISTS daily_allocation_published_visits_source_uniq
  ON public.daily_allocation_published_visits (publication_id, source_visit_id)
  WHERE source_visit_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.daily_allocation_published_labour (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id UUID NOT NULL REFERENCES public.daily_allocation_publications(id) ON DELETE RESTRICT,
  published_visit_id UUID REFERENCES public.daily_allocation_published_visits(id) ON DELETE RESTRICT,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  availability TEXT NOT NULL,
  unallocated BOOLEAN NOT NULL DEFAULT FALSE,
  job_source_type TEXT,
  job_source_id UUID,
  job_code TEXT,
  site_address TEXT,
  customer_name TEXT,
  title TEXT,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
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
  override_kind TEXT,
  override_evidence TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT daily_allocation_published_labour_availability_check
    CHECK (availability IN ('available', 'full_day_absence', 'half_day_absence')),
  CONSTRAINT daily_allocation_published_labour_shape_check CHECK (
    (
      unallocated = TRUE
      AND published_visit_id IS NULL
      AND availability = 'available'
    )
    OR (
      availability = 'full_day_absence'
      AND published_visit_id IS NULL
      AND unallocated = FALSE
    )
    OR (
      unallocated = FALSE
      AND published_visit_id IS NOT NULL
      AND availability IN ('available', 'half_day_absence')
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS daily_allocation_published_labour_visit_uniq
  ON public.daily_allocation_published_labour (publication_id, published_visit_id, profile_id)
  WHERE published_visit_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS daily_allocation_published_labour_unallocated_uniq
  ON public.daily_allocation_published_labour (publication_id, profile_id)
  WHERE published_visit_id IS NULL;

CREATE TABLE IF NOT EXISTS public.daily_allocation_published_plant (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id UUID NOT NULL REFERENCES public.daily_allocation_publications(id) ON DELETE RESTRICT,
  published_visit_id UUID NOT NULL REFERENCES public.daily_allocation_published_visits(id) ON DELETE RESTRICT,
  plant_kind TEXT NOT NULL,
  plant_id UUID REFERENCES public.plant(id) ON DELETE RESTRICT,
  hired_serial TEXT,
  hired_description TEXT,
  hired_company TEXT,
  hired_serial_normalized TEXT,
  hired_company_normalized TEXT,
  owner_team_id TEXT,
  job_source_type TEXT NOT NULL,
  job_source_id UUID NOT NULL,
  job_code TEXT NOT NULL,
  site_address TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT daily_allocation_published_plant_kind_check
    CHECK (plant_kind IN ('registered', 'hired'))
);

CREATE TABLE IF NOT EXISTS public.daily_allocation_published_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id UUID NOT NULL REFERENCES public.daily_allocation_publications(id) ON DELETE RESTRICT,
  conflict_kind TEXT NOT NULL,
  profile_id UUID,
  source_visit_id UUID,
  plant_id UUID,
  conflict_signature TEXT,
  evidence TEXT NOT NULL,
  confirmed_by UUID NOT NULL,
  confirmed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.daily_allocation_published_overrides
  ADD COLUMN IF NOT EXISTS conflict_signature TEXT;

CREATE TABLE IF NOT EXISTS public.daily_allocation_publication_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id UUID NOT NULL REFERENCES public.daily_allocation_publications(id) ON DELETE RESTRICT,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT daily_allocation_publication_notifications_unique
    UNIQUE (publication_id, profile_id),
  CONSTRAINT daily_allocation_publication_notifications_message_unique
    UNIQUE (message_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'daily_allocation_publications_plan_day_fk'
  ) THEN
    ALTER TABLE public.daily_allocation_publications
      ADD CONSTRAINT daily_allocation_publications_plan_day_fk
      FOREIGN KEY (plan_day_id)
      REFERENCES public.daily_allocation_plan_days(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'daily_allocation_visit_labour_excl_overlap'
  ) THEN
    ALTER TABLE public.daily_allocation_visit_labour
      ADD CONSTRAINT daily_allocation_visit_labour_excl_overlap
      EXCLUDE USING gist (
        profile_id WITH =,
        tstzrange(starts_at, ends_at, '[)') WITH &&
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'daily_allocation_visit_plant_registered_excl_overlap'
  ) THEN
    ALTER TABLE public.daily_allocation_visit_plant
      ADD CONSTRAINT daily_allocation_visit_plant_registered_excl_overlap
      EXCLUDE USING gist (
        plant_id WITH =,
        tstzrange(starts_at, ends_at, '[)') WITH &&
      )
      WHERE (plant_kind = 'registered' AND plant_id IS NOT NULL);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'daily_allocation_visit_plant_hired_excl_overlap'
  ) THEN
    ALTER TABLE public.daily_allocation_visit_plant
      ADD CONSTRAINT daily_allocation_visit_plant_hired_excl_overlap
      EXCLUDE USING gist (
        hired_serial_normalized WITH =,
        hired_company_normalized WITH =,
        tstzrange(starts_at, ends_at, '[)') WITH &&
      )
      WHERE (plant_kind = 'hired');
  END IF;
END $$;

DROP TRIGGER IF EXISTS set_updated_at_daily_allocation_plan_days
  ON public.daily_allocation_plan_days;
CREATE TRIGGER set_updated_at_daily_allocation_plan_days
  BEFORE UPDATE ON public.daily_allocation_plan_days
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at_daily_allocation_visits
  ON public.daily_allocation_visits;
CREATE TRIGGER set_updated_at_daily_allocation_visits
  BEFORE UPDATE ON public.daily_allocation_visits
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at_daily_allocation_visit_labour
  ON public.daily_allocation_visit_labour;
CREATE TRIGGER set_updated_at_daily_allocation_visit_labour
  BEFORE UPDATE ON public.daily_allocation_visit_labour
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at_daily_allocation_visit_plant
  ON public.daily_allocation_visit_plant;
CREATE TRIGGER set_updated_at_daily_allocation_visit_plant
  BEFORE UPDATE ON public.daily_allocation_visit_plant
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.reject_converted_v1_daily_allocation_write(
  p_work_date DATE,
  p_team_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_work_date IS NULL OR p_team_id IS NULL THEN
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.daily_allocation_plan_days plan_days
    WHERE plan_days.work_date = p_work_date
      AND plan_days.team_id = p_team_id
  ) THEN
    RAISE EXCEPTION 'V1_WRITES_DISABLED';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.lock_daily_allocation_plan_day(
  p_work_date DATE,
  p_team_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_work_date::TEXT)::bigint);
  PERFORM pg_advisory_xact_lock(
    hashtextextended('daily-allocation-plan:' || p_work_date::TEXT || ':' || COALESCE(p_team_id, ''), 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.lock_daily_allocation_resource_keys(
  p_profile_ids UUID[],
  p_plant_ids UUID[],
  p_hired_keys TEXT[]
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  profile_id UUID;
  plant_id UUID;
  hired_key TEXT;
BEGIN
  FOR profile_id IN
    SELECT ids
    FROM UNNEST(COALESCE(p_profile_ids, ARRAY[]::UUID[])) AS ids
    ORDER BY ids
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended('daily-allocation-labour:' || profile_id::TEXT, 0)
    );
  END LOOP;

  FOR plant_id IN
    SELECT ids
    FROM UNNEST(COALESCE(p_plant_ids, ARRAY[]::UUID[])) AS ids
    ORDER BY ids
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended('daily-allocation-plant:' || plant_id::TEXT, 0)
    );
  END LOOP;

  FOR hired_key IN
    SELECT keys
    FROM UNNEST(COALESCE(p_hired_keys, ARRAY[]::TEXT[])) AS keys
    ORDER BY keys
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended('daily-allocation-hired:' || hired_key, 0)
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION private.require_daily_allocation_v2_writer()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_id UUID := auth.uid();
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF public.view_as_role_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Daily allocation cannot be changed while viewing as another role';
  END IF;
  IF NOT private.daily_allocation_v2_writes_allowed() THEN
    RAISE EXCEPTION 'V2_DISABLED';
  END IF;
  IF NOT public.effective_has_module_level('daily-allocation', 4) THEN
    RAISE EXCEPTION 'Manager-level daily allocation access is required';
  END IF;
  RETURN actor_id;
END;
$$;

CREATE OR REPLACE FUNCTION private.bump_daily_allocation_plan_version(
  p_plan_day_id UUID,
  p_expected_plan_version INTEGER,
  p_actor_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  next_version INTEGER;
BEGIN
  UPDATE public.daily_allocation_plan_days
  SET
    plan_version = plan_version + 1,
    updated_by = p_actor_id
  WHERE id = p_plan_day_id
    AND plan_version = p_expected_plan_version
  RETURNING plan_version INTO next_version;

  IF next_version IS NULL THEN
    RAISE EXCEPTION 'STALE_PLAN_VERSION';
  END IF;
  RETURN next_version;
END;
$$;

CREATE OR REPLACE FUNCTION private.daily_allocation_overlaps_london_session(
  p_starts_at TIMESTAMPTZ,
  p_ends_at TIMESTAMPTZ,
  p_session TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT tstzrange(p_starts_at, p_ends_at, '[)') && tstzrange(
    (
      ((p_starts_at AT TIME ZONE 'Europe/London')::DATE
        + CASE WHEN p_session = 'AM' THEN TIME '00:00' ELSE TIME '12:00' END)
      AT TIME ZONE 'Europe/London'
    ),
    (
      CASE
        WHEN p_session = 'AM' THEN
          ((p_starts_at AT TIME ZONE 'Europe/London')::DATE + TIME '12:00')
        ELSE
          (((p_starts_at AT TIME ZONE 'Europe/London')::DATE + 1) + TIME '00:00')
      END
      AT TIME ZONE 'Europe/London'
    ),
    '[)'
  );
$$;

CREATE OR REPLACE FUNCTION private.daily_allocation_v2_shift_session_working(
  p_profile_id UUID,
  p_work_date DATE,
  p_session TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  dow INTEGER := EXTRACT(ISODOW FROM p_work_date)::INTEGER;
  am_working BOOLEAN;
  pm_working BOOLEAN;
BEGIN
  SELECT
    CASE dow
      WHEN 1 THEN shifts.monday_am
      WHEN 2 THEN shifts.tuesday_am
      WHEN 3 THEN shifts.wednesday_am
      WHEN 4 THEN shifts.thursday_am
      WHEN 5 THEN shifts.friday_am
      WHEN 6 THEN shifts.saturday_am
      ELSE shifts.sunday_am
    END,
    CASE dow
      WHEN 1 THEN shifts.monday_pm
      WHEN 2 THEN shifts.tuesday_pm
      WHEN 3 THEN shifts.wednesday_pm
      WHEN 4 THEN shifts.thursday_pm
      WHEN 5 THEN shifts.friday_pm
      WHEN 6 THEN shifts.saturday_pm
      ELSE shifts.sunday_pm
    END
  INTO am_working, pm_working
  FROM public.employee_work_shifts shifts
  WHERE shifts.profile_id = p_profile_id;

  IF am_working IS NULL THEN
    am_working := dow BETWEEN 1 AND 5;
    pm_working := dow BETWEEN 1 AND 5;
  END IF;

  IF p_session = 'AM' THEN
    RETURN am_working;
  END IF;
  RETURN pm_working;
END;
$$;

CREATE OR REPLACE FUNCTION private.daily_allocation_v2_conflict_signature(
  p_kind TEXT,
  p_profile_id UUID,
  p_visit_id UUID,
  p_work_date DATE,
  p_starts_at TIMESTAMPTZ,
  p_ends_at TIMESTAMPTZ
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  conflict_payload JSONB;
  pending_absences JSONB;
  shift_row JSONB;
  am_overlaps BOOLEAN;
  pm_overlaps BOOLEAN;
  am_working BOOLEAN;
  pm_working BOOLEAN;
BEGIN
  IF p_profile_id IS NULL
    OR p_visit_id IS NULL
    OR p_work_date IS NULL
    OR p_starts_at IS NULL
    OR p_ends_at IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_kind = 'pending_absence' THEN
    SELECT JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'id', absences.id,
        'reason_id', absences.reason_id,
        'allocation_behaviour', absence_reasons.allocation_behaviour,
        'status', absences.status,
        'date', absences.date,
        'end_date', absences.end_date,
        'is_half_day', absences.is_half_day,
        'half_day_session', absences.half_day_session,
        'updated_at', absences.updated_at
      )
      ORDER BY absences.id
    )
    INTO pending_absences
    FROM public.absences absences
    JOIN public.absence_reasons absence_reasons ON absence_reasons.id = absences.reason_id
    WHERE absences.profile_id = p_profile_id
      AND absences.status = 'pending'
      AND p_work_date >= absences.date
      AND p_work_date <= COALESCE(absences.end_date, absences.date)
      AND (
        NOT COALESCE(absences.is_half_day, FALSE)
        OR absences.half_day_session IS NULL
        OR (
          absences.half_day_session = 'AM'
          AND private.daily_allocation_overlaps_london_session(p_starts_at, p_ends_at, 'AM')
        )
        OR (
          absences.half_day_session = 'PM'
          AND private.daily_allocation_overlaps_london_session(p_starts_at, p_ends_at, 'PM')
        )
      );

    IF pending_absences IS NULL THEN
      RETURN NULL;
    END IF;

    conflict_payload := JSONB_BUILD_OBJECT(
      'kind', p_kind,
      'profile_id', p_profile_id,
      'visit_id', p_visit_id,
      'work_date', p_work_date,
      'starts_at', p_starts_at,
      'ends_at', p_ends_at,
      'pending_absences', pending_absences
    );
  ELSIF p_kind = 'off_shift' THEN
    am_overlaps := private.daily_allocation_overlaps_london_session(p_starts_at, p_ends_at, 'AM');
    pm_overlaps := private.daily_allocation_overlaps_london_session(p_starts_at, p_ends_at, 'PM');
    am_working := private.daily_allocation_v2_shift_session_working(p_profile_id, p_work_date, 'AM');
    pm_working := private.daily_allocation_v2_shift_session_working(p_profile_id, p_work_date, 'PM');

    IF NOT ((am_overlaps AND NOT am_working) OR (pm_overlaps AND NOT pm_working)) THEN
      RETURN NULL;
    END IF;

    SELECT TO_JSONB(shifts)
    INTO shift_row
    FROM public.employee_work_shifts shifts
    WHERE shifts.profile_id = p_profile_id;

    conflict_payload := JSONB_BUILD_OBJECT(
      'kind', p_kind,
      'profile_id', p_profile_id,
      'visit_id', p_visit_id,
      'work_date', p_work_date,
      'starts_at', p_starts_at,
      'ends_at', p_ends_at,
      'shift', shift_row,
      'session_result', JSONB_BUILD_OBJECT(
        'am_overlaps', am_overlaps,
        'am_working', am_working,
        'pm_overlaps', pm_overlaps,
        'pm_working', pm_working
      )
    );
  ELSE
    RETURN NULL;
  END IF;

  RETURN ENCODE(DIGEST(CONVERT_TO(conflict_payload::TEXT, 'utf8'), 'sha256'), 'hex');
END;
$$;

CREATE OR REPLACE FUNCTION private.daily_allocation_v2_has_override(
  p_plan_day_id UUID,
  p_profile_id UUID,
  p_visit_id UUID,
  p_kind TEXT,
  p_conflict_signature TEXT,
  p_override_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.daily_allocation_conflict_overrides overrides
    WHERE overrides.plan_day_id = p_plan_day_id
      AND overrides.profile_id = p_profile_id
      AND overrides.conflict_kind = p_kind
      AND overrides.visit_id = p_visit_id
      AND overrides.conflict_signature = p_conflict_signature
      AND (p_override_id IS NULL OR overrides.id = p_override_id)
  );
$$;

CREATE OR REPLACE FUNCTION private.lock_daily_allocation_visit_resources(p_visit_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  labour_ids UUID[];
  plant_ids UUID[];
  hired_keys TEXT[];
BEGIN
  SELECT ARRAY_AGG(labour.profile_id ORDER BY labour.profile_id)
  INTO labour_ids
  FROM public.daily_allocation_visit_labour labour
  WHERE labour.visit_id = p_visit_id;

  SELECT ARRAY_AGG(plant.plant_id ORDER BY plant.plant_id) FILTER (WHERE plant.plant_id IS NOT NULL)
  INTO plant_ids
  FROM public.daily_allocation_visit_plant plant
  WHERE plant.visit_id = p_visit_id;

  SELECT ARRAY_AGG(
    plant.hired_serial_normalized || ':' || plant.hired_company_normalized
    ORDER BY plant.hired_serial_normalized, plant.hired_company_normalized
  ) FILTER (WHERE plant.plant_kind = 'hired')
  INTO hired_keys
  FROM public.daily_allocation_visit_plant plant
  WHERE plant.visit_id = p_visit_id;

  PERFORM private.lock_daily_allocation_resource_keys(labour_ids, plant_ids, hired_keys);
END;
$$;

CREATE OR REPLACE FUNCTION private.daily_allocation_v2_assert_labour_assignable(
  p_plan_day_id UUID,
  p_visit_id UUID,
  p_profile_id UUID,
  p_work_date DATE,
  p_starts_at TIMESTAMPTZ,
  p_ends_at TIMESTAMPTZ,
  p_override_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  pending_conflict_signature TEXT;
  off_shift_conflict_signature TEXT;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.absences absences
    JOIN public.absence_reasons absence_reasons ON absence_reasons.id = absences.reason_id
    WHERE absences.profile_id = p_profile_id
      AND absences.status IN ('approved', 'processed')
      AND absence_reasons.allocation_behaviour IN ('block', 'reduce')
      AND p_work_date >= absences.date
      AND p_work_date <= COALESCE(absences.end_date, absences.date)
      AND (
        NOT COALESCE(absences.is_half_day, FALSE)
        OR absences.half_day_session IS NULL
        OR (
          absences.half_day_session = 'AM'
          AND private.daily_allocation_overlaps_london_session(p_starts_at, p_ends_at, 'AM')
        )
        OR (
          absences.half_day_session = 'PM'
          AND private.daily_allocation_overlaps_london_session(p_starts_at, p_ends_at, 'PM')
        )
      )
  ) THEN
    RAISE EXCEPTION 'HARD_CONFLICT';
  END IF;

  pending_conflict_signature := private.daily_allocation_v2_conflict_signature(
    'pending_absence',
    p_profile_id,
    p_visit_id,
    p_work_date,
    p_starts_at,
    p_ends_at
  );
  IF pending_conflict_signature IS NOT NULL
    AND NOT private.daily_allocation_v2_has_override(
      p_plan_day_id,
      p_profile_id,
      p_visit_id,
      'pending_absence',
      pending_conflict_signature,
      p_override_id
    ) THEN
    RAISE EXCEPTION 'HARD_CONFLICT';
  END IF;

  off_shift_conflict_signature := private.daily_allocation_v2_conflict_signature(
    'off_shift',
    p_profile_id,
    p_visit_id,
    p_work_date,
    p_starts_at,
    p_ends_at
  );
  IF off_shift_conflict_signature IS NOT NULL
    AND NOT private.daily_allocation_v2_has_override(
      p_plan_day_id,
      p_profile_id,
      p_visit_id,
      'off_shift',
      off_shift_conflict_signature,
      p_override_id
    ) THEN
    RAISE EXCEPTION 'HARD_CONFLICT';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.daily_allocation_v2_lock_job_source(
  p_job_source_type TEXT,
  p_job_source_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_job_source_type = 'live_quote' THEN
    PERFORM 1 FROM public.quotes WHERE id = p_job_source_id FOR UPDATE;
  ELSIF p_job_source_type = 'legacy_quote' THEN
    PERFORM 1 FROM public.legacy_quotes WHERE id = p_job_source_id FOR UPDATE;
  ELSIF p_job_source_type = 'project_number' THEN
    PERFORM 1 FROM public.quote_project_numbers WHERE id = p_job_source_id FOR UPDATE;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.daily_allocation_v2_lock_publish_inputs(
  p_plan_day_id UUID,
  p_work_date DATE,
  p_scope_ids UUID[]
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  labour_ids UUID[];
  plant_ids UUID[];
  hired_keys TEXT[];
  job_row RECORD;
BEGIN
  SELECT COALESCE(ARRAY_AGG(labour.profile_id ORDER BY labour.profile_id), ARRAY[]::UUID[])
  INTO labour_ids
  FROM public.daily_allocation_visit_labour labour
  WHERE labour.plan_day_id = p_plan_day_id;

  SELECT COALESCE(
    ARRAY_AGG(plant.plant_id ORDER BY plant.plant_id) FILTER (WHERE plant.plant_id IS NOT NULL),
    ARRAY[]::UUID[]
  )
  INTO plant_ids
  FROM public.daily_allocation_visit_plant plant
  WHERE plant.plan_day_id = p_plan_day_id;

  SELECT COALESCE(
    ARRAY_AGG(
      plant.hired_serial_normalized || ':' || plant.hired_company_normalized
      ORDER BY plant.hired_serial_normalized, plant.hired_company_normalized
    ) FILTER (WHERE plant.plant_kind = 'hired'),
    ARRAY[]::TEXT[]
  )
  INTO hired_keys
  FROM public.daily_allocation_visit_plant plant
  WHERE plant.plan_day_id = p_plan_day_id;

  PERFORM private.lock_daily_allocation_resource_keys(
    (
      SELECT COALESCE(ARRAY_AGG(ids ORDER BY ids), ARRAY[]::UUID[])
      FROM (
        SELECT DISTINCT profile_id AS ids
        FROM UNNEST(COALESCE(p_scope_ids, ARRAY[]::UUID[]) || COALESCE(labour_ids, ARRAY[]::UUID[])) AS profile_id
      ) unique_profiles
    ),
    plant_ids,
    hired_keys
  );

  FOR job_row IN
    SELECT DISTINCT visits.job_source_type, visits.job_source_id
    FROM public.daily_allocation_visits visits
    WHERE visits.plan_day_id = p_plan_day_id
    ORDER BY visits.job_source_type, visits.job_source_id
  LOOP
    PERFORM private.daily_allocation_v2_lock_job_source(job_row.job_source_type, job_row.job_source_id);
  END LOOP;

  PERFORM 1
  FROM public.daily_allocation_visits
  WHERE plan_day_id = p_plan_day_id
  ORDER BY id
  FOR UPDATE;

  PERFORM 1
  FROM public.daily_allocation_visit_labour
  WHERE plan_day_id = p_plan_day_id
  ORDER BY id
  FOR UPDATE;

  PERFORM 1
  FROM public.daily_allocation_visit_plant
  WHERE plan_day_id = p_plan_day_id
  ORDER BY id
  FOR UPDATE;

  PERFORM 1
  FROM public.daily_allocation_conflict_overrides
  WHERE plan_day_id = p_plan_day_id
  ORDER BY id
  FOR UPDATE;
END;
$$;

CREATE OR REPLACE FUNCTION private.daily_allocation_v2_hash_snapshot_payload(p_payload JSONB)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public, extensions
AS $$
BEGIN
  RETURN ENCODE(DIGEST(CONVERT_TO(p_payload::TEXT, 'utf8'), 'sha256'), 'hex');
END;
$$;

CREATE OR REPLACE FUNCTION private.daily_allocation_v2_plan_fingerprint(
  p_plan_day_id UUID,
  p_plan_version INTEGER,
  p_scope_ids UUID[],
  p_confirm_unallocated BOOLEAN,
  p_idempotency_key TEXT,
  p_revision_no INTEGER,
  p_published_by UUID,
  p_published_at TIMESTAMPTZ
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  payload JSONB;
BEGIN
  SELECT JSONB_BUILD_OBJECT(
    'publication', JSONB_BUILD_OBJECT(
      'snapshot_version', 2,
      'plan_day_id', plan_days.id,
      'work_date', plan_days.work_date,
      'revision_no', p_revision_no,
      'idempotency_key', p_idempotency_key,
      'published_by', p_published_by,
      'published_at', p_published_at,
      'scope_team_id', plan_days.team_id,
      'published_plan_version', p_plan_version,
      'confirm_unallocated', COALESCE(p_confirm_unallocated, FALSE),
      'scope_profile_ids', TO_JSONB(COALESCE(
        (SELECT ARRAY_AGG(scope_id ORDER BY scope_id)
         FROM UNNEST(COALESCE(p_scope_ids, ARRAY[]::UUID[])) AS scope_id),
        ARRAY[]::UUID[]
      ))
    ),
    'visits', COALESCE((
      SELECT JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'source_visit_id', visits.id,
          'sequence_no', visits.sequence_no,
          'work_date', visits.work_date,
          'owner_team_id', visits.owner_team_id,
          'job_source_type', visits.job_source_type,
          'job_source_id', visits.job_source_id,
          'job_code', visits.job_code,
          'site_address', visits.site_address,
          'customer_name', visits.customer_name,
          'title', visits.title,
          'starts_at', visits.starts_at,
          'ends_at', visits.ends_at,
          'meeting_point', visits.meeting_point,
          'meet_person', visits.meet_person,
          'notes', visits.notes
        )
        ORDER BY visits.sequence_no, visits.id
      )
      FROM pg_temp.da2_snap_visits visits
    ), '[]'::JSONB),
    'labour', COALESCE((
      SELECT JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'source_visit_id', labour.visit_id,
          'profile_id', labour.profile_id,
          'availability', labour.availability,
          'unallocated', labour.unallocated,
          'job_source_type', labour.job_source_type,
          'job_source_id', labour.job_source_id,
          'job_code', labour.job_code,
          'site_address', labour.site_address,
          'customer_name', labour.customer_name,
          'title', labour.title,
          'starts_at', labour.starts_at,
          'ends_at', labour.ends_at,
          'meeting_point', labour.meeting_point,
          'meet_person', labour.meet_person,
          'notes', labour.notes,
          'absence_id', labour.absence_id,
          'absence_reason_id', labour.absence_reason_id,
          'absence_reason_name', labour.absence_reason_name,
          'absence_colour', labour.absence_colour,
          'absence_is_paid', labour.absence_is_paid,
          'absence_is_half_day', labour.absence_is_half_day,
          'absence_half_day_session', labour.absence_half_day_session,
          'absence_status', labour.absence_status,
          'absence_allocation_behaviour', labour.absence_allocation_behaviour,
          'override_kind', labour.override_kind,
          'override_evidence', labour.override_evidence
        )
        ORDER BY labour.profile_id, labour.visit_id NULLS FIRST
      )
      FROM pg_temp.da2_snap_labour labour
    ), '[]'::JSONB),
    'plant', COALESCE((
      SELECT JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'source_visit_id', plant.visit_id,
          'plant_kind', plant.plant_kind,
          'plant_id', plant.plant_id,
          'hired_serial', plant.hired_serial,
          'hired_description', plant.hired_description,
          'hired_company', plant.hired_company,
          'hired_serial_normalized', plant.hired_serial_normalized,
          'hired_company_normalized', plant.hired_company_normalized,
          'owner_team_id', plant.owner_team_id,
          'job_source_type', plant.job_source_type,
          'job_source_id', plant.job_source_id,
          'job_code', plant.job_code,
          'site_address', plant.site_address,
          'starts_at', plant.starts_at,
          'ends_at', plant.ends_at,
          'notes', plant.notes
        )
        ORDER BY plant.visit_id, plant.plant_kind, plant.plant_id NULLS FIRST,
          plant.hired_serial_normalized NULLS FIRST, plant.hired_company_normalized NULLS FIRST
      )
      FROM pg_temp.da2_snap_plant plant
    ), '[]'::JSONB),
    'overrides', COALESCE((
      SELECT JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'conflict_kind', overrides.conflict_kind,
          'profile_id', overrides.profile_id,
          'source_visit_id', overrides.visit_id,
          'plant_id', overrides.plant_id,
          'conflict_signature', overrides.conflict_signature,
          'evidence', overrides.evidence,
          'confirmed_by', overrides.confirmed_by,
          'confirmed_at', overrides.confirmed_at
        )
        ORDER BY overrides.conflict_kind, overrides.profile_id NULLS FIRST,
          overrides.visit_id NULLS FIRST, overrides.plant_id NULLS FIRST,
          overrides.conflict_signature, overrides.evidence,
          overrides.confirmed_by, overrides.confirmed_at
      )
      FROM pg_temp.da2_snap_overrides overrides
    ), '[]'::JSONB)
  )
  INTO payload
  FROM public.daily_allocation_plan_days plan_days
  WHERE plan_days.id = p_plan_day_id;

  RETURN private.daily_allocation_v2_hash_snapshot_payload(payload);
END;
$$;

CREATE OR REPLACE FUNCTION private.daily_allocation_v2_persisted_fingerprint(p_publication_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  payload JSONB;
BEGIN
  SELECT JSONB_BUILD_OBJECT(
    'publication', JSONB_BUILD_OBJECT(
      'snapshot_version', publications.snapshot_version,
      'plan_day_id', publications.plan_day_id,
      'work_date', publications.work_date,
      'revision_no', publications.revision_no,
      'idempotency_key', publications.idempotency_key,
      'published_by', publications.published_by,
      'published_at', publications.published_at,
      'scope_team_id', publications.scope_team_id,
      'published_plan_version', publications.published_plan_version,
      'confirm_unallocated', publications.confirm_unallocated,
      'scope_profile_ids', TO_JSONB(COALESCE(
        (SELECT ARRAY_AGG(scope_id ORDER BY scope_id)
         FROM UNNEST(COALESCE(publications.scope_profile_ids, ARRAY[]::UUID[])) AS scope_id),
        ARRAY[]::UUID[]
      ))
    ),
    'visits', COALESCE((
      SELECT JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'source_visit_id', visits.source_visit_id,
          'sequence_no', visits.sequence_no,
          'work_date', visits.work_date,
          'owner_team_id', visits.owner_team_id,
          'job_source_type', visits.job_source_type,
          'job_source_id', visits.job_source_id,
          'job_code', visits.job_code,
          'site_address', visits.site_address,
          'customer_name', visits.customer_name,
          'title', visits.title,
          'starts_at', visits.starts_at,
          'ends_at', visits.ends_at,
          'meeting_point', visits.meeting_point,
          'meet_person', visits.meet_person,
          'notes', visits.notes
        )
        ORDER BY visits.sequence_no, visits.source_visit_id
      )
      FROM public.daily_allocation_published_visits visits
      WHERE visits.publication_id = publications.id
    ), '[]'::JSONB),
    'labour', COALESCE((
      SELECT JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'source_visit_id', visits.source_visit_id,
          'profile_id', labour.profile_id,
          'availability', labour.availability,
          'unallocated', labour.unallocated,
          'job_source_type', labour.job_source_type,
          'job_source_id', labour.job_source_id,
          'job_code', labour.job_code,
          'site_address', labour.site_address,
          'customer_name', labour.customer_name,
          'title', labour.title,
          'starts_at', labour.starts_at,
          'ends_at', labour.ends_at,
          'meeting_point', labour.meeting_point,
          'meet_person', labour.meet_person,
          'notes', labour.notes,
          'absence_id', labour.absence_id,
          'absence_reason_id', labour.absence_reason_id,
          'absence_reason_name', labour.absence_reason_name,
          'absence_colour', labour.absence_colour,
          'absence_is_paid', labour.absence_is_paid,
          'absence_is_half_day', labour.absence_is_half_day,
          'absence_half_day_session', labour.absence_half_day_session,
          'absence_status', labour.absence_status,
          'absence_allocation_behaviour', labour.absence_allocation_behaviour,
          'override_kind', labour.override_kind,
          'override_evidence', labour.override_evidence
        )
        ORDER BY labour.profile_id, visits.source_visit_id NULLS FIRST
      )
      FROM public.daily_allocation_published_labour labour
      LEFT JOIN public.daily_allocation_published_visits visits
        ON visits.id = labour.published_visit_id
      WHERE labour.publication_id = publications.id
    ), '[]'::JSONB),
    'plant', COALESCE((
      SELECT JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'source_visit_id', visits.source_visit_id,
          'plant_kind', plant.plant_kind,
          'plant_id', plant.plant_id,
          'hired_serial', plant.hired_serial,
          'hired_description', plant.hired_description,
          'hired_company', plant.hired_company,
          'hired_serial_normalized', plant.hired_serial_normalized,
          'hired_company_normalized', plant.hired_company_normalized,
          'owner_team_id', plant.owner_team_id,
          'job_source_type', plant.job_source_type,
          'job_source_id', plant.job_source_id,
          'job_code', plant.job_code,
          'site_address', plant.site_address,
          'starts_at', plant.starts_at,
          'ends_at', plant.ends_at,
          'notes', plant.notes
        )
        ORDER BY visits.source_visit_id, plant.plant_kind, plant.plant_id NULLS FIRST,
          plant.hired_serial_normalized NULLS FIRST, plant.hired_company_normalized NULLS FIRST
      )
      FROM public.daily_allocation_published_plant plant
      JOIN public.daily_allocation_published_visits visits
        ON visits.id = plant.published_visit_id
      WHERE plant.publication_id = publications.id
    ), '[]'::JSONB),
    'overrides', COALESCE((
      SELECT JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'conflict_kind', overrides.conflict_kind,
          'profile_id', overrides.profile_id,
          'source_visit_id', overrides.source_visit_id,
          'plant_id', overrides.plant_id,
          'conflict_signature', overrides.conflict_signature,
          'evidence', overrides.evidence,
          'confirmed_by', overrides.confirmed_by,
          'confirmed_at', overrides.confirmed_at
        )
        ORDER BY overrides.conflict_kind, overrides.profile_id NULLS FIRST,
          overrides.source_visit_id NULLS FIRST, overrides.plant_id NULLS FIRST,
          overrides.conflict_signature, overrides.evidence,
          overrides.confirmed_by, overrides.confirmed_at
      )
      FROM public.daily_allocation_published_overrides overrides
      WHERE overrides.publication_id = publications.id
    ), '[]'::JSONB)
  )
  INTO payload
  FROM public.daily_allocation_publications publications
  WHERE publications.id = p_publication_id
    AND publications.snapshot_version = 2;

  IF payload IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN private.daily_allocation_v2_hash_snapshot_payload(payload);
END;
$$;

CREATE OR REPLACE FUNCTION private.sync_daily_allocation_assignment_interval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  visit_row public.daily_allocation_visits%ROWTYPE;
BEGIN
  SELECT * INTO visit_row
  FROM public.daily_allocation_visits
  WHERE id = NEW.visit_id;

  IF visit_row.id IS NULL THEN
    RAISE EXCEPTION 'Visit not found';
  END IF;

  NEW.plan_day_id := visit_row.plan_day_id;
  NEW.work_date := visit_row.work_date;
  NEW.starts_at := visit_row.starts_at;
  NEW.ends_at := visit_row.ends_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS daily_allocation_visit_labour_sync_interval
  ON public.daily_allocation_visit_labour;
CREATE TRIGGER daily_allocation_visit_labour_sync_interval
  BEFORE INSERT OR UPDATE OF visit_id
  ON public.daily_allocation_visit_labour
  FOR EACH ROW
  EXECUTE FUNCTION private.sync_daily_allocation_assignment_interval();

DROP TRIGGER IF EXISTS daily_allocation_visit_plant_sync_interval
  ON public.daily_allocation_visit_plant;
CREATE TRIGGER daily_allocation_visit_plant_sync_interval
  BEFORE INSERT OR UPDATE OF visit_id
  ON public.daily_allocation_visit_plant
  FOR EACH ROW
  EXECUTE FUNCTION private.sync_daily_allocation_assignment_interval();

CREATE OR REPLACE FUNCTION private.propagate_daily_allocation_visit_interval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.starts_at IS DISTINCT FROM OLD.starts_at
    OR NEW.ends_at IS DISTINCT FROM OLD.ends_at
    OR NEW.work_date IS DISTINCT FROM OLD.work_date
    OR NEW.plan_day_id IS DISTINCT FROM OLD.plan_day_id THEN
    UPDATE public.daily_allocation_visit_labour
    SET
      starts_at = NEW.starts_at,
      ends_at = NEW.ends_at,
      work_date = NEW.work_date,
      plan_day_id = NEW.plan_day_id
    WHERE visit_id = NEW.id;

    UPDATE public.daily_allocation_visit_plant
    SET
      starts_at = NEW.starts_at,
      ends_at = NEW.ends_at,
      work_date = NEW.work_date,
      plan_day_id = NEW.plan_day_id
    WHERE visit_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS daily_allocation_visits_propagate_interval
  ON public.daily_allocation_visits;
CREATE TRIGGER daily_allocation_visits_propagate_interval
  AFTER UPDATE OF starts_at, ends_at, work_date, plan_day_id
  ON public.daily_allocation_visits
  FOR EACH ROW
  EXECUTE FUNCTION private.propagate_daily_allocation_visit_interval();

CREATE OR REPLACE FUNCTION private.sync_daily_allocation_visit_plant_job_claims()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  plant_row public.daily_allocation_visit_plant%ROWTYPE;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;
  IF NEW.work_date IS DISTINCT FROM OLD.work_date THEN
    RETURN NEW;
  END IF;
  IF NEW.job_source_type IS NOT DISTINCT FROM OLD.job_source_type
    AND NEW.job_source_id IS NOT DISTINCT FROM OLD.job_source_id
    AND NEW.job_code IS NOT DISTINCT FROM OLD.job_code THEN
    RETURN NEW;
  END IF;

  FOR plant_row IN
    SELECT *
    FROM public.daily_allocation_visit_plant plant
    WHERE plant.visit_id = NEW.id
    ORDER BY plant.id
  LOOP
    PERFORM private.release_daily_allocation_plant_day_job(
      OLD.work_date,
      plant_row.plant_kind,
      plant_row.plant_id,
      plant_row.hired_serial_normalized,
      plant_row.hired_company_normalized
    );
    PERFORM private.claim_daily_allocation_plant_day_job(
      NEW.work_date,
      plant_row.plant_kind,
      plant_row.plant_id,
      plant_row.hired_serial_normalized,
      plant_row.hired_company_normalized,
      NEW.job_source_type,
      NEW.job_source_id,
      NEW.job_code
    );
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS daily_allocation_visits_sync_plant_job_claims
  ON public.daily_allocation_visits;
CREATE TRIGGER daily_allocation_visits_sync_plant_job_claims
  AFTER UPDATE OF job_source_type, job_source_id, job_code
  ON public.daily_allocation_visits
  FOR EACH ROW
  EXECUTE FUNCTION private.sync_daily_allocation_visit_plant_job_claims();

CREATE OR REPLACE FUNCTION private.release_daily_allocation_plant_day_job(
  p_work_date DATE,
  p_plant_kind TEXT,
  p_plant_id UUID,
  p_hired_serial_normalized TEXT,
  p_hired_company_normalized TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_plant_kind = 'registered' THEN
    UPDATE private.daily_allocation_plant_day_jobs
    SET ref_count = ref_count - 1
    WHERE work_date = p_work_date
      AND plant_kind = 'registered'
      AND plant_id = p_plant_id
      AND ref_count > 0;
    DELETE FROM private.daily_allocation_plant_day_jobs
    WHERE work_date = p_work_date
      AND plant_kind = 'registered'
      AND plant_id = p_plant_id
      AND ref_count <= 0;
  ELSE
    UPDATE private.daily_allocation_plant_day_jobs
    SET ref_count = ref_count - 1
    WHERE work_date = p_work_date
      AND plant_kind = 'hired'
      AND hired_serial_normalized = p_hired_serial_normalized
      AND hired_company_normalized = p_hired_company_normalized
      AND ref_count > 0;
    DELETE FROM private.daily_allocation_plant_day_jobs
    WHERE work_date = p_work_date
      AND plant_kind = 'hired'
      AND hired_serial_normalized = p_hired_serial_normalized
      AND hired_company_normalized = p_hired_company_normalized
      AND ref_count <= 0;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.claim_daily_allocation_plant_day_job(
  p_work_date DATE,
  p_plant_kind TEXT,
  p_plant_id UUID,
  p_hired_serial_normalized TEXT,
  p_hired_company_normalized TEXT,
  p_job_source_type TEXT,
  p_job_source_id UUID,
  p_job_code TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  claim private.daily_allocation_plant_day_jobs%ROWTYPE;
BEGIN
  IF p_plant_kind = 'registered' THEN
    SELECT * INTO claim
    FROM private.daily_allocation_plant_day_jobs
    WHERE work_date = p_work_date
      AND plant_kind = 'registered'
      AND plant_id = p_plant_id
    FOR UPDATE;
  ELSE
    SELECT * INTO claim
    FROM private.daily_allocation_plant_day_jobs
    WHERE work_date = p_work_date
      AND plant_kind = 'hired'
      AND hired_serial_normalized = p_hired_serial_normalized
      AND hired_company_normalized = p_hired_company_normalized
    FOR UPDATE;
  END IF;

  IF claim.id IS NOT NULL THEN
    IF claim.job_source_type IS DISTINCT FROM p_job_source_type
      OR claim.job_source_id IS DISTINCT FROM p_job_source_id THEN
      RAISE EXCEPTION 'PLANT_JOB_CONFLICT';
    END IF;
    UPDATE private.daily_allocation_plant_day_jobs
    SET ref_count = ref_count + 1
    WHERE id = claim.id;
    RETURN;
  END IF;

  INSERT INTO private.daily_allocation_plant_day_jobs (
    work_date,
    plant_kind,
    plant_id,
    hired_serial_normalized,
    hired_company_normalized,
    job_source_type,
    job_source_id,
    job_code,
    ref_count
  ) VALUES (
    p_work_date,
    p_plant_kind,
    p_plant_id,
    p_hired_serial_normalized,
    p_hired_company_normalized,
    p_job_source_type,
    p_job_source_id,
    p_job_code,
    1
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.guard_daily_allocation_plant_day_job()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  visit_row public.daily_allocation_visits%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM private.release_daily_allocation_plant_day_job(
      OLD.work_date,
      OLD.plant_kind,
      OLD.plant_id,
      OLD.hired_serial_normalized,
      OLD.hired_company_normalized
    );
    RETURN OLD;
  END IF;

  SELECT * INTO visit_row
  FROM public.daily_allocation_visits
  WHERE id = NEW.visit_id;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.visit_id IS NOT DISTINCT FROM NEW.visit_id
      AND OLD.work_date IS NOT DISTINCT FROM NEW.work_date
      AND OLD.plant_kind IS NOT DISTINCT FROM NEW.plant_kind
      AND OLD.plant_id IS NOT DISTINCT FROM NEW.plant_id
      AND OLD.hired_serial_normalized IS NOT DISTINCT FROM NEW.hired_serial_normalized
      AND OLD.hired_company_normalized IS NOT DISTINCT FROM NEW.hired_company_normalized THEN
      RETURN NEW;
    END IF;
    PERFORM private.release_daily_allocation_plant_day_job(
      OLD.work_date,
      OLD.plant_kind,
      OLD.plant_id,
      OLD.hired_serial_normalized,
      OLD.hired_company_normalized
    );
  END IF;

  PERFORM private.claim_daily_allocation_plant_day_job(
    NEW.work_date,
    NEW.plant_kind,
    NEW.plant_id,
    NEW.hired_serial_normalized,
    NEW.hired_company_normalized,
    visit_row.job_source_type,
    visit_row.job_source_id,
    visit_row.job_code
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS daily_allocation_visit_plant_day_job
  ON public.daily_allocation_visit_plant;
CREATE TRIGGER daily_allocation_visit_plant_day_job
  AFTER INSERT OR UPDATE OR DELETE ON public.daily_allocation_visit_plant
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_daily_allocation_plant_day_job();

CREATE OR REPLACE FUNCTION private.guard_daily_allocation_plan_day_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'Converted daily allocation plan days cannot be deleted';
END;
$$;

DROP TRIGGER IF EXISTS daily_allocation_plan_days_immutable_delete
  ON public.daily_allocation_plan_days;
CREATE TRIGGER daily_allocation_plan_days_immutable_delete
  BEFORE DELETE ON public.daily_allocation_plan_days
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_daily_allocation_plan_day_delete();

DROP TRIGGER IF EXISTS daily_allocation_published_visits_immutable
  ON public.daily_allocation_published_visits;
CREATE TRIGGER daily_allocation_published_visits_immutable
  BEFORE UPDATE OR DELETE ON public.daily_allocation_published_visits
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_daily_allocation_immutable();

DROP TRIGGER IF EXISTS daily_allocation_published_labour_immutable
  ON public.daily_allocation_published_labour;
CREATE TRIGGER daily_allocation_published_labour_immutable
  BEFORE UPDATE OR DELETE ON public.daily_allocation_published_labour
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_daily_allocation_immutable();

DROP TRIGGER IF EXISTS daily_allocation_published_plant_immutable
  ON public.daily_allocation_published_plant;
CREATE TRIGGER daily_allocation_published_plant_immutable
  BEFORE UPDATE OR DELETE ON public.daily_allocation_published_plant
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_daily_allocation_immutable();

DROP TRIGGER IF EXISTS daily_allocation_published_overrides_immutable
  ON public.daily_allocation_published_overrides;
CREATE TRIGGER daily_allocation_published_overrides_immutable
  BEFORE UPDATE OR DELETE ON public.daily_allocation_published_overrides
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_daily_allocation_immutable();

DROP TRIGGER IF EXISTS daily_allocation_publication_notifications_immutable
  ON public.daily_allocation_publication_notifications;
CREATE TRIGGER daily_allocation_publication_notifications_immutable
  BEFORE UPDATE OR DELETE ON public.daily_allocation_publication_notifications
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_daily_allocation_immutable();

-- ---------------------------------------------------------------------------
-- Cutover-aware v1 draft guards (CREATE OR REPLACE; preserve v1 rules)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.guard_daily_labour_allocation_draft_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job private.allocation_job;
  v_team_id TEXT;
BEGIN
  IF public.view_as_role_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Daily allocation cannot be changed while viewing as another role';
  END IF;

  IF TG_OP = 'DELETE' THEN
    SELECT team_id INTO v_team_id FROM public.profiles WHERE id = OLD.profile_id;
    PERFORM private.reject_converted_v1_daily_allocation_write(OLD.work_date, v_team_id);
    IF NOT public.can_actor_manage_daily_allocation(OLD.profile_id) THEN
      RAISE EXCEPTION 'Not allowed to change this labour allocation';
    END IF;
    RETURN OLD;
  END IF;

  SELECT team_id INTO v_team_id FROM public.profiles WHERE id = NEW.profile_id;
  PERFORM private.reject_converted_v1_daily_allocation_write(NEW.work_date, v_team_id);

  IF NOT public.can_actor_manage_daily_allocation(NEW.profile_id) THEN
    RAISE EXCEPTION 'Not allowed to change this labour allocation';
  END IF;

  IF NEW.job_source_type IS NOT NULL OR NEW.job_code IS NOT NULL THEN
    v_job := private.apply_allocation_job_fields(
      NEW.job_source_type,
      NEW.job_source_id,
      NEW.job_code,
      TRUE
    );
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
END;
$$;

CREATE OR REPLACE FUNCTION private.guard_daily_plant_allocation_draft_write()
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

  IF TG_OP = 'DELETE' THEN
    PERFORM private.reject_converted_v1_daily_allocation_write(OLD.work_date, OLD.owner_team_id);
    IF NOT (
      public.can_actor_manage_daily_allocation_team(OLD.owner_team_id)
      OR public.effective_module_access_level('daily-allocation') >= 5
    ) THEN
      RAISE EXCEPTION 'Not allowed to change this plant allocation';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF public.effective_module_access_level('daily-allocation') < 5
      OR NEW.owner_team_id IS NULL THEN
      SELECT team_id INTO NEW.owner_team_id
      FROM public.profiles
      WHERE id = auth.uid();
    END IF;
    IF NOT public.can_actor_manage_daily_allocation_team(NEW.owner_team_id)
      AND public.effective_module_access_level('daily-allocation') < 5 THEN
      RAISE EXCEPTION 'Not allowed to allocate plant';
    END IF;
  ELSE
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

  PERFORM private.reject_converted_v1_daily_allocation_write(NEW.work_date, NEW.owner_team_id);

  v_job := private.apply_allocation_job_fields(
    NEW.job_source_type,
    NEW.job_source_id,
    NEW.job_code,
    TRUE
  );
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

-- ---------------------------------------------------------------------------
-- v1 publish triggers: skip snapshot_version = 2; reject converted team/date
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.prepare_daily_allocation_publication()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_id UUID := auth.uid();
  actor_team_id TEXT;
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

  NEW.snapshot_version := COALESCE(NEW.snapshot_version, 1);
  IF NEW.snapshot_version NOT IN (1, 2) THEN
    RAISE EXCEPTION 'Unsupported daily allocation snapshot version';
  END IF;

  SELECT COALESCE(MAX(revision_no), 0) + 1
  INTO next_revision
  FROM public.daily_allocation_publications
  WHERE work_date = NEW.work_date;

  NEW.id := COALESCE(NEW.id, gen_random_uuid());
  NEW.revision_no := next_revision;
  NEW.published_by := actor_id;
  NEW.published_at := NOW();
  NEW.idempotency_key := NULLIF(BTRIM(NEW.idempotency_key), '');
  IF NEW.idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Idempotency key is required';
  END IF;

  IF NEW.snapshot_version = 2 THEN
    IF NOT private.daily_allocation_v2_writes_allowed() THEN
      RAISE EXCEPTION 'V2_DISABLED';
    END IF;
    IF NEW.plan_day_id IS NULL THEN
      RAISE EXCEPTION 'V2 publication requires a converted plan day';
    END IF;
    NEW.scope_team_id := COALESCE(NEW.scope_team_id, actor_team_id);
    IF NEW.scope_profile_ids IS NULL THEN
      NEW.scope_profile_ids := ARRAY[]::UUID[];
    END IF;
    RETURN NEW;
  END IF;

  PERFORM private.reject_converted_v1_daily_allocation_write(NEW.work_date, actor_team_id);
  NEW.scope_team_id := actor_team_id;

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
  IF COALESCE(NEW.snapshot_version, 1) = 2 THEN
    RETURN NEW;
  END IF;

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
      hired_company_normalized,
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
      plant_row.hired_company_normalized,
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

CREATE OR REPLACE FUNCTION private.guard_daily_allocation_message_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.daily_allocation_labour_item_id IS NOT NULL
      OR OLD.daily_allocation_publication_id IS NOT NULL THEN
      RAISE EXCEPTION 'Published allocation messages cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.daily_allocation_labour_item_id IS NOT NULL
    OR OLD.daily_allocation_publication_id IS NOT NULL THEN
    IF NEW.subject IS DISTINCT FROM OLD.subject
      OR NEW.body IS DISTINCT FROM OLD.body
      OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
      OR NEW.module_key IS DISTINCT FROM OLD.module_key
      OR NEW.daily_allocation_labour_item_id IS DISTINCT FROM OLD.daily_allocation_labour_item_id
      OR NEW.daily_allocation_publication_id IS DISTINCT FROM OLD.daily_allocation_publication_id
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

CREATE OR REPLACE FUNCTION private.guard_daily_allocation_recipient_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  expected_profile_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (
      SELECT 1
      FROM public.messages
      WHERE messages.id = OLD.message_id
        AND (
          messages.daily_allocation_labour_item_id IS NOT NULL
          OR messages.daily_allocation_publication_id IS NOT NULL
        )
    ) THEN
      RAISE EXCEPTION 'Published allocation message recipients cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  SELECT COALESCE(labour_items.profile_id, notifications.profile_id)
  INTO expected_profile_id
  FROM public.messages
  LEFT JOIN public.daily_allocation_labour_items labour_items
    ON labour_items.id = messages.daily_allocation_labour_item_id
  LEFT JOIN public.daily_allocation_publication_notifications notifications
    ON notifications.message_id = messages.id
  WHERE messages.id = COALESCE(NEW.message_id, OLD.message_id)
    AND (
      messages.daily_allocation_labour_item_id IS NOT NULL
      OR messages.daily_allocation_publication_id IS NOT NULL
    );

  IF expected_profile_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.user_id IS DISTINCT FROM expected_profile_id THEN
      RAISE EXCEPTION 'Published allocation message recipients cannot be redirected';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.message_id IS DISTINCT FROM OLD.message_id
    OR NEW.user_id IS DISTINCT FROM expected_profile_id THEN
    RAISE EXCEPTION 'Published allocation message recipients cannot be redirected';
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Transactional v2 RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.convert_daily_allocation_plan_day_v2(
  p_work_date DATE,
  p_team_id TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_id UUID;
  plan_day_id UUID;
BEGIN
  actor_id := private.require_daily_allocation_v2_writer();
  IF NOT public.can_actor_manage_daily_allocation_team(p_team_id) THEN
    RAISE EXCEPTION 'Not allowed to convert this daily allocation plan';
  END IF;

  PERFORM private.lock_daily_allocation_plan_day(p_work_date, p_team_id);

  INSERT INTO public.daily_allocation_plan_days (
    work_date,
    team_id,
    plan_version,
    converted_by,
    created_by,
    updated_by
  )
  VALUES (
    p_work_date,
    p_team_id,
    1,
    actor_id,
    actor_id,
    actor_id
  )
  ON CONFLICT (work_date, team_id) DO NOTHING
  RETURNING id INTO plan_day_id;

  IF plan_day_id IS NULL THEN
    SELECT id INTO plan_day_id
    FROM public.daily_allocation_plan_days
    WHERE work_date = p_work_date
      AND team_id = p_team_id;
  END IF;

  RETURN plan_day_id;
END;
$$;

DROP FUNCTION IF EXISTS public.upsert_daily_allocation_visit_v2(UUID, UUID, INTEGER, INTEGER, TEXT, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.upsert_daily_allocation_visit_v2(
  p_visit_id UUID,
  p_plan_day_id UUID,
  p_expected_plan_version INTEGER,
  p_expected_row_version INTEGER,
  p_job_source_type TEXT,
  p_job_source_id UUID,
  p_job_code TEXT,
  p_starts_at TIMESTAMPTZ,
  p_ends_at TIMESTAMPTZ,
  p_meeting_point TEXT DEFAULT NULL,
  p_meet_person TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_id UUID;
  plan_day public.daily_allocation_plan_days%ROWTYPE;
  job_row private.allocation_job;
  visit_id UUID;
  visit_row public.daily_allocation_visits%ROWTYPE;
  labour_ids UUID[];
  plant_ids UUID[];
  hired_keys TEXT[];
  next_version INTEGER;
BEGIN
  actor_id := private.require_daily_allocation_v2_writer();
  SELECT * INTO plan_day FROM public.daily_allocation_plan_days WHERE id = p_plan_day_id;
  IF plan_day.id IS NULL THEN
    RAISE EXCEPTION 'Plan day not found';
  END IF;
  IF NOT public.can_actor_manage_daily_allocation_team(plan_day.team_id) THEN
    RAISE EXCEPTION 'Not allowed to change this daily allocation plan';
  END IF;
  IF NOT private.daily_allocation_interval_is_valid(plan_day.work_date, p_starts_at, p_ends_at) THEN
    RAISE EXCEPTION 'Invalid visit interval';
  END IF;

  PERFORM private.lock_daily_allocation_plan_day(plan_day.work_date, plan_day.team_id);

  IF p_visit_id IS NOT NULL THEN
    SELECT ARRAY_AGG(labour.profile_id) INTO labour_ids
    FROM public.daily_allocation_visit_labour labour
    WHERE labour.visit_id = p_visit_id;
    SELECT ARRAY_AGG(plant.plant_id) FILTER (WHERE plant.plant_id IS NOT NULL) INTO plant_ids
    FROM public.daily_allocation_visit_plant plant
    WHERE plant.visit_id = p_visit_id;
    SELECT ARRAY_AGG(plant.hired_serial_normalized || ':' || plant.hired_company_normalized)
      FILTER (WHERE plant.plant_kind = 'hired')
    INTO hired_keys
    FROM public.daily_allocation_visit_plant plant
    WHERE plant.visit_id = p_visit_id;
    PERFORM private.lock_daily_allocation_resource_keys(labour_ids, plant_ids, hired_keys);
  END IF;

  PERFORM private.daily_allocation_v2_lock_job_source(p_job_source_type, p_job_source_id);
  job_row := private.apply_allocation_job_fields(
    p_job_source_type,
    p_job_source_id,
    p_job_code,
    TRUE
  );

  next_version := private.bump_daily_allocation_plan_version(
    p_plan_day_id,
    p_expected_plan_version,
    actor_id
  );

  IF p_visit_id IS NULL THEN
    INSERT INTO public.daily_allocation_visits (
      plan_day_id,
      work_date,
      owner_team_id,
      job_source_type,
      job_source_id,
      job_code,
      site_address,
      starts_at,
      ends_at,
      meeting_point,
      meet_person,
      notes,
      created_by,
      updated_by
    ) VALUES (
      p_plan_day_id,
      plan_day.work_date,
      plan_day.team_id,
      job_row.source_type,
      job_row.source_id,
      job_row.job_code,
      job_row.site_address,
      p_starts_at,
      p_ends_at,
      p_meeting_point,
      p_meet_person,
      p_notes,
      actor_id,
      actor_id
    ) RETURNING id INTO visit_id;
  ELSE
    UPDATE public.daily_allocation_visits
    SET
      job_source_type = job_row.source_type,
      job_source_id = job_row.source_id,
      job_code = job_row.job_code,
      site_address = job_row.site_address,
      starts_at = p_starts_at,
      ends_at = p_ends_at,
      meeting_point = p_meeting_point,
      meet_person = p_meet_person,
      notes = p_notes,
      row_version = row_version + 1,
      updated_by = actor_id
    WHERE id = p_visit_id
      AND plan_day_id = p_plan_day_id
      AND row_version = p_expected_row_version
    RETURNING id INTO visit_id;
    IF visit_id IS NULL THEN
      RAISE EXCEPTION 'STALE_ENTITY_VERSION';
    END IF;
  END IF;

  SELECT * INTO visit_row FROM public.daily_allocation_visits WHERE id = visit_id;
  RETURN jsonb_build_object(
    'visit_id', visit_row.id,
    'plan_day_id', visit_row.plan_day_id,
    'plan_version', next_version,
    'visit', jsonb_build_object(
      'id', visit_row.id,
      'plan_day_id', visit_row.plan_day_id,
      'work_date', visit_row.work_date,
      'owner_team_id', visit_row.owner_team_id,
      'job_source_type', visit_row.job_source_type,
      'job_source_id', visit_row.job_source_id,
      'job_code', visit_row.job_code,
      'site_address', visit_row.site_address,
      'starts_at', visit_row.starts_at,
      'ends_at', visit_row.ends_at,
      'meeting_point', visit_row.meeting_point,
      'meet_person', visit_row.meet_person,
      'notes', visit_row.notes,
      'row_version', visit_row.row_version,
      'updated_at', visit_row.updated_at
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_daily_allocation_visit_v2(
  p_visit_id UUID,
  p_expected_plan_version INTEGER,
  p_expected_row_version INTEGER
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_id UUID;
  visit_row public.daily_allocation_visits%ROWTYPE;
  plan_day public.daily_allocation_plan_days%ROWTYPE;
BEGIN
  actor_id := private.require_daily_allocation_v2_writer();
  SELECT * INTO visit_row FROM public.daily_allocation_visits WHERE id = p_visit_id;
  IF visit_row.id IS NULL THEN
    RAISE EXCEPTION 'Visit not found';
  END IF;
  SELECT * INTO plan_day FROM public.daily_allocation_plan_days WHERE id = visit_row.plan_day_id;
  IF NOT public.can_actor_manage_daily_allocation_team(plan_day.team_id) THEN
    RAISE EXCEPTION 'Not allowed to change this daily allocation plan';
  END IF;

  PERFORM private.lock_daily_allocation_plan_day(plan_day.work_date, plan_day.team_id);
  PERFORM private.lock_daily_allocation_visit_resources(p_visit_id);
  PERFORM private.daily_allocation_v2_lock_job_source(
    visit_row.job_source_type,
    visit_row.job_source_id
  );

  SELECT * INTO visit_row FROM public.daily_allocation_visits WHERE id = p_visit_id;
  IF visit_row.id IS NULL THEN
    RAISE EXCEPTION 'Visit not found';
  END IF;
  IF visit_row.row_version <> p_expected_row_version THEN
    RAISE EXCEPTION 'STALE_ENTITY_VERSION';
  END IF;

  PERFORM private.bump_daily_allocation_plan_version(
    plan_day.id,
    p_expected_plan_version,
    actor_id
  );
  DELETE FROM public.daily_allocation_visits WHERE id = p_visit_id;
  RETURN p_visit_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_daily_allocation_labour_v2(
  p_visit_id UUID,
  p_profile_id UUID,
  p_expected_plan_version INTEGER,
  p_meeting_point TEXT DEFAULT NULL,
  p_meet_person TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_override_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_id UUID;
  visit_row public.daily_allocation_visits%ROWTYPE;
  plan_day public.daily_allocation_plan_days%ROWTYPE;
  assignment_id UUID;
BEGIN
  actor_id := private.require_daily_allocation_v2_writer();
  IF NOT public.can_actor_manage_daily_allocation(p_profile_id) THEN
    RAISE EXCEPTION 'Not allowed to change this labour allocation';
  END IF;
  SELECT * INTO visit_row FROM public.daily_allocation_visits WHERE id = p_visit_id;
  IF visit_row.id IS NULL THEN
    RAISE EXCEPTION 'Visit not found';
  END IF;
  SELECT * INTO plan_day FROM public.daily_allocation_plan_days WHERE id = visit_row.plan_day_id;
  IF NOT public.can_actor_manage_daily_allocation_team(plan_day.team_id) THEN
    RAISE EXCEPTION 'Not allowed to change this daily allocation plan';
  END IF;

  PERFORM private.lock_daily_allocation_plan_day(plan_day.work_date, plan_day.team_id);
  PERFORM private.lock_daily_allocation_resource_keys(
    ARRAY[p_profile_id],
    ARRAY[]::UUID[],
    ARRAY[]::TEXT[]
  );

  SELECT * INTO visit_row FROM public.daily_allocation_visits WHERE id = p_visit_id;
  SELECT * INTO plan_day FROM public.daily_allocation_plan_days WHERE id = visit_row.plan_day_id;

  PERFORM private.daily_allocation_v2_assert_labour_assignable(
    plan_day.id,
    p_visit_id,
    p_profile_id,
    visit_row.work_date,
    visit_row.starts_at,
    visit_row.ends_at,
    p_override_id
  );

  PERFORM private.bump_daily_allocation_plan_version(
    plan_day.id,
    p_expected_plan_version,
    actor_id
  );

  INSERT INTO public.daily_allocation_visit_labour (
    visit_id,
    plan_day_id,
    work_date,
    profile_id,
    starts_at,
    ends_at,
    meeting_point,
    meet_person,
    notes,
    created_by,
    updated_by
  ) VALUES (
    p_visit_id,
    visit_row.plan_day_id,
    visit_row.work_date,
    p_profile_id,
    visit_row.starts_at,
    visit_row.ends_at,
    p_meeting_point,
    p_meet_person,
    p_notes,
    actor_id,
    actor_id
  )
  ON CONFLICT (visit_id, profile_id) DO UPDATE
  SET
    meeting_point = EXCLUDED.meeting_point,
    meet_person = EXCLUDED.meet_person,
    notes = EXCLUDED.notes,
    row_version = daily_allocation_visit_labour.row_version + 1,
    updated_by = actor_id
  RETURNING id INTO assignment_id;

  RETURN assignment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.unassign_daily_allocation_labour_v2(
  p_assignment_id UUID,
  p_expected_plan_version INTEGER
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_id UUID;
  assignment public.daily_allocation_visit_labour%ROWTYPE;
  plan_day public.daily_allocation_plan_days%ROWTYPE;
BEGIN
  actor_id := private.require_daily_allocation_v2_writer();
  SELECT * INTO assignment FROM public.daily_allocation_visit_labour WHERE id = p_assignment_id;
  IF assignment.id IS NULL THEN
    RAISE EXCEPTION 'Labour assignment not found';
  END IF;
  IF NOT public.can_actor_manage_daily_allocation(assignment.profile_id) THEN
    RAISE EXCEPTION 'Not allowed to change this labour allocation';
  END IF;
  SELECT * INTO plan_day FROM public.daily_allocation_plan_days WHERE id = assignment.plan_day_id;
  PERFORM private.lock_daily_allocation_plan_day(plan_day.work_date, plan_day.team_id);
  PERFORM private.lock_daily_allocation_resource_keys(
    ARRAY[assignment.profile_id],
    ARRAY[]::UUID[],
    ARRAY[]::TEXT[]
  );
  PERFORM private.bump_daily_allocation_plan_version(
    plan_day.id,
    p_expected_plan_version,
    actor_id
  );
  DELETE FROM public.daily_allocation_visit_labour WHERE id = p_assignment_id;
  RETURN p_assignment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_daily_allocation_plant_v2(
  p_visit_id UUID,
  p_expected_plan_version INTEGER,
  p_plant_kind TEXT,
  p_plant_id UUID DEFAULT NULL,
  p_hired_serial TEXT DEFAULT NULL,
  p_hired_description TEXT DEFAULT NULL,
  p_hired_company TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_id UUID;
  visit_row public.daily_allocation_visits%ROWTYPE;
  plan_day public.daily_allocation_plan_days%ROWTYPE;
  assignment_id UUID;
  hired_key TEXT;
BEGIN
  actor_id := private.require_daily_allocation_v2_writer();
  SELECT * INTO visit_row FROM public.daily_allocation_visits WHERE id = p_visit_id;
  IF visit_row.id IS NULL THEN
    RAISE EXCEPTION 'Visit not found';
  END IF;
  SELECT * INTO plan_day FROM public.daily_allocation_plan_days WHERE id = visit_row.plan_day_id;
  IF NOT (
    public.effective_module_access_level('daily-allocation') >= 5
    OR public.can_actor_manage_daily_allocation_team(plan_day.team_id)
  ) THEN
    RAISE EXCEPTION 'Not allowed to allocate plant';
  END IF;

  hired_key := NULLIF(
    UPPER(BTRIM(regexp_replace(COALESCE(p_hired_serial, ''), '\s+', ' ', 'g')))
    || ':'
    || UPPER(BTRIM(regexp_replace(COALESCE(p_hired_company, ''), '\s+', ' ', 'g'))),
    ':'
  );

  PERFORM private.lock_daily_allocation_plan_day(plan_day.work_date, plan_day.team_id);
  PERFORM private.lock_daily_allocation_resource_keys(
    ARRAY[]::UUID[],
    CASE WHEN p_plant_id IS NULL THEN ARRAY[]::UUID[] ELSE ARRAY[p_plant_id] END,
    CASE WHEN hired_key IS NULL THEN ARRAY[]::TEXT[] ELSE ARRAY[hired_key] END
  );
  PERFORM private.daily_allocation_v2_lock_job_source(
    visit_row.job_source_type,
    visit_row.job_source_id
  );
  PERFORM private.bump_daily_allocation_plan_version(
    plan_day.id,
    p_expected_plan_version,
    actor_id
  );

  INSERT INTO public.daily_allocation_visit_plant (
    visit_id,
    plan_day_id,
    work_date,
    plant_kind,
    plant_id,
    hired_serial,
    hired_description,
    hired_company,
    owner_team_id,
    starts_at,
    ends_at,
    notes,
    created_by,
    updated_by
  ) VALUES (
    p_visit_id,
    visit_row.plan_day_id,
    visit_row.work_date,
    p_plant_kind,
    p_plant_id,
    p_hired_serial,
    p_hired_description,
    p_hired_company,
    plan_day.team_id,
    visit_row.starts_at,
    visit_row.ends_at,
    p_notes,
    actor_id,
    actor_id
  ) RETURNING id INTO assignment_id;

  RETURN assignment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.unassign_daily_allocation_plant_v2(
  p_assignment_id UUID,
  p_expected_plan_version INTEGER
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_id UUID;
  assignment public.daily_allocation_visit_plant%ROWTYPE;
  plan_day public.daily_allocation_plan_days%ROWTYPE;
  visit_row public.daily_allocation_visits%ROWTYPE;
  hired_key TEXT;
BEGIN
  actor_id := private.require_daily_allocation_v2_writer();
  SELECT * INTO assignment FROM public.daily_allocation_visit_plant WHERE id = p_assignment_id;
  IF assignment.id IS NULL THEN
    RAISE EXCEPTION 'Plant assignment not found';
  END IF;
  SELECT * INTO plan_day FROM public.daily_allocation_plan_days WHERE id = assignment.plan_day_id;
  IF NOT (
    public.effective_module_access_level('daily-allocation') >= 5
    OR public.can_actor_manage_daily_allocation_team(assignment.owner_team_id)
  ) THEN
    RAISE EXCEPTION 'Not allowed to change this plant allocation';
  END IF;
  SELECT * INTO visit_row
  FROM public.daily_allocation_visits
  WHERE id = assignment.visit_id;
  hired_key := CASE
    WHEN assignment.plant_kind = 'hired'
      THEN assignment.hired_serial_normalized || ':' || assignment.hired_company_normalized
    ELSE NULL
  END;
  PERFORM private.lock_daily_allocation_plan_day(plan_day.work_date, plan_day.team_id);
  PERFORM private.lock_daily_allocation_resource_keys(
    ARRAY[]::UUID[],
    CASE WHEN assignment.plant_id IS NULL THEN ARRAY[]::UUID[] ELSE ARRAY[assignment.plant_id] END,
    CASE WHEN hired_key IS NULL THEN ARRAY[]::TEXT[] ELSE ARRAY[hired_key] END
  );
  PERFORM private.daily_allocation_v2_lock_job_source(
    visit_row.job_source_type,
    visit_row.job_source_id
  );
  PERFORM private.bump_daily_allocation_plan_version(
    plan_day.id,
    p_expected_plan_version,
    actor_id
  );
  DELETE FROM public.daily_allocation_visit_plant WHERE id = p_assignment_id;
  RETURN p_assignment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_daily_allocation_plan_v2(
  p_plan_day_id UUID,
  p_expected_plan_version INTEGER,
  p_idempotency_key TEXT,
  p_confirm_unallocated BOOLEAN
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id UUID;
  plan_day public.daily_allocation_plan_days%ROWTYPE;
  existing_id UUID;
  publication_id UUID;
  v_publication_id UUID;
  scope_ids UUID[];
  profile_row RECORD;
  visit_row RECORD;
  labour_row RECORD;
  plant_row RECORD;
  override_row RECORD;
  absence_row RECORD;
  job_row private.allocation_job;
  published_visit_id UUID;
  sequence_no INTEGER := 0;
  availability TEXT;
  assigned BOOLEAN;
  unallocated_count INTEGER := 0;
  body TEXT;
  message_id UUID;
  fingerprint TEXT;
  persisted_fingerprint TEXT;
  next_revision INTEGER;
  publication_time TIMESTAMPTZ;
  pending_override_id UUID;
  off_shift_override_id UUID;
  pending_conflict_signature TEXT;
  off_shift_conflict_signature TEXT;
  override_kind TEXT;
  override_evidence TEXT;
BEGIN
  actor_id := private.require_daily_allocation_v2_writer();
  SELECT * INTO plan_day FROM public.daily_allocation_plan_days WHERE id = p_plan_day_id;
  IF plan_day.id IS NULL THEN
    RAISE EXCEPTION 'Plan day not found';
  END IF;
  IF NOT public.can_actor_manage_daily_allocation_team(plan_day.team_id) THEN
    RAISE EXCEPTION 'Not allowed to publish this daily allocation plan';
  END IF;
  IF NULLIF(BTRIM(p_idempotency_key), '') IS NULL THEN
    RAISE EXCEPTION 'Idempotency key is required';
  END IF;

  PERFORM private.lock_daily_allocation_plan_day(plan_day.work_date, plan_day.team_id);
  SELECT * INTO plan_day FROM public.daily_allocation_plan_days WHERE id = p_plan_day_id;

  SELECT id INTO existing_id
  FROM public.daily_allocation_publications
  WHERE idempotency_key = p_idempotency_key;
  IF existing_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.daily_allocation_publications publications
      WHERE publications.id = existing_id
        AND publications.snapshot_version = 2
        AND publications.plan_day_id = p_plan_day_id
        AND publications.published_plan_version = p_expected_plan_version
    ) THEN
      RETURN existing_id;
    END IF;
    RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';
  END IF;

  IF plan_day.plan_version <> p_expected_plan_version THEN
    RAISE EXCEPTION 'STALE_PLAN_VERSION';
  END IF;

  LOCK TABLE public.profiles IN SHARE MODE;
  LOCK TABLE public.absences IN SHARE MODE;
  LOCK TABLE public.absence_reasons IN SHARE MODE;
  LOCK TABLE public.employee_work_shifts IN SHARE MODE;
  LOCK TABLE public.quotes IN SHARE MODE;
  LOCK TABLE public.legacy_quotes IN SHARE MODE;
  LOCK TABLE public.quote_project_numbers IN SHARE MODE;

  SELECT COALESCE(ARRAY_AGG(profiles.id ORDER BY profiles.full_name, profiles.id), ARRAY[]::UUID[])
  INTO scope_ids
  FROM public.profiles
  WHERE profiles.team_id = plan_day.team_id
    AND COALESCE(profiles.is_placeholder, FALSE) = FALSE
    AND NOT private.is_hidden_daily_allocation_profile(profiles.employee_id, profiles.full_name);

  IF scope_ids IS NULL OR ARRAY_LENGTH(scope_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'No employees are in scope for this publication';
  END IF;

  PERFORM private.daily_allocation_v2_lock_publish_inputs(plan_day.id, plan_day.work_date, scope_ids);
  SELECT * INTO plan_day FROM public.daily_allocation_plan_days WHERE id = p_plan_day_id;
  IF plan_day.plan_version <> p_expected_plan_version THEN
    RAISE EXCEPTION 'STALE_PLAN_VERSION';
  END IF;

  DROP TABLE IF EXISTS pg_temp.da2_snap_visits;
  DROP TABLE IF EXISTS pg_temp.da2_snap_labour;
  DROP TABLE IF EXISTS pg_temp.da2_snap_plant;
  DROP TABLE IF EXISTS pg_temp.da2_snap_overrides;
  DROP TABLE IF EXISTS pg_temp.da2_snap_availability;

  CREATE TEMP TABLE pg_temp.da2_snap_visits (
    id UUID PRIMARY KEY,
    sequence_no INTEGER NOT NULL,
    work_date DATE NOT NULL,
    owner_team_id TEXT,
    job_source_type TEXT NOT NULL,
    job_source_id UUID NOT NULL,
    job_code TEXT NOT NULL,
    site_address TEXT NOT NULL,
    customer_name TEXT,
    title TEXT,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    meeting_point TEXT,
    meet_person TEXT,
    notes TEXT
  ) ON COMMIT DROP;

  CREATE TEMP TABLE pg_temp.da2_snap_labour (
    visit_id UUID,
    profile_id UUID NOT NULL,
    availability TEXT NOT NULL,
    unallocated BOOLEAN NOT NULL,
    job_source_type TEXT,
    job_source_id UUID,
    job_code TEXT,
    site_address TEXT,
    customer_name TEXT,
    title TEXT,
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
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
    override_id UUID,
    override_kind TEXT,
    override_evidence TEXT
  ) ON COMMIT DROP;

  CREATE TEMP TABLE pg_temp.da2_snap_plant (
    visit_id UUID NOT NULL,
    plant_kind TEXT NOT NULL,
    plant_id UUID,
    hired_serial TEXT,
    hired_description TEXT,
    hired_company TEXT,
    hired_serial_normalized TEXT,
    hired_company_normalized TEXT,
    owner_team_id TEXT,
    job_source_type TEXT,
    job_source_id UUID,
    job_code TEXT,
    site_address TEXT,
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    notes TEXT
  ) ON COMMIT DROP;

  CREATE TEMP TABLE pg_temp.da2_snap_overrides (
    id UUID PRIMARY KEY,
    conflict_kind TEXT NOT NULL,
    profile_id UUID,
    visit_id UUID,
    plant_id UUID,
    conflict_signature TEXT,
    evidence TEXT NOT NULL,
    confirmed_by UUID NOT NULL,
    confirmed_at TIMESTAMPTZ NOT NULL
  ) ON COMMIT DROP;

  CREATE TEMP TABLE pg_temp.da2_snap_availability (
    profile_id UUID PRIMARY KEY,
    availability TEXT NOT NULL,
    unallocated BOOLEAN NOT NULL,
    absence_id UUID,
    absence_reason_id UUID,
    absence_reason_name TEXT,
    absence_colour TEXT,
    absence_is_paid BOOLEAN,
    absence_is_half_day BOOLEAN,
    absence_half_day_session TEXT,
    absence_status TEXT,
    absence_allocation_behaviour TEXT
  ) ON COMMIT DROP;

  INSERT INTO pg_temp.da2_snap_overrides (
    id, conflict_kind, profile_id, visit_id, plant_id, conflict_signature,
    evidence, confirmed_by, confirmed_at
  )
  SELECT
    overrides.id,
    overrides.conflict_kind,
    overrides.profile_id,
    overrides.visit_id,
    overrides.plant_id,
    overrides.conflict_signature,
    overrides.evidence,
    overrides.confirmed_by,
    overrides.confirmed_at
  FROM public.daily_allocation_conflict_overrides overrides
  JOIN public.daily_allocation_visits override_visits
    ON override_visits.id = overrides.visit_id
  WHERE overrides.plan_day_id = plan_day.id
    AND overrides.profile_id IS NOT NULL
    AND overrides.conflict_signature = private.daily_allocation_v2_conflict_signature(
      overrides.conflict_kind,
      overrides.profile_id,
      overrides.visit_id,
      override_visits.work_date,
      override_visits.starts_at,
      override_visits.ends_at
    )
  ORDER BY overrides.id;

  FOR visit_row IN
    SELECT *
    FROM public.daily_allocation_visits
    WHERE plan_day_id = plan_day.id
    ORDER BY starts_at, id
  LOOP
    sequence_no := sequence_no + 1;
    job_row := private.apply_allocation_job_fields(
      visit_row.job_source_type,
      visit_row.job_source_id,
      visit_row.job_code,
      TRUE
    );
    INSERT INTO pg_temp.da2_snap_visits (
      id, sequence_no, work_date, owner_team_id, job_source_type, job_source_id, job_code,
      site_address, customer_name, title, starts_at, ends_at, meeting_point, meet_person, notes
    ) VALUES (
      visit_row.id,
      sequence_no,
      visit_row.work_date,
      visit_row.owner_team_id,
      job_row.source_type,
      job_row.source_id,
      job_row.job_code,
      job_row.site_address,
      job_row.customer_name,
      job_row.title,
      visit_row.starts_at,
      visit_row.ends_at,
      visit_row.meeting_point,
      visit_row.meet_person,
      visit_row.notes
    );

    FOR labour_row IN
      SELECT *
      FROM public.daily_allocation_visit_labour labour
      WHERE labour.visit_id = visit_row.id
      ORDER BY labour.profile_id
    LOOP
      absence_row := NULL;
      PERFORM private.daily_allocation_v2_assert_labour_assignable(
        plan_day.id,
        visit_row.id,
        labour_row.profile_id,
        visit_row.work_date,
        visit_row.starts_at,
        visit_row.ends_at,
        NULL
      );

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
      WHERE absences.profile_id = labour_row.profile_id
        AND visit_row.work_date >= absences.date
        AND visit_row.work_date <= COALESCE(absences.end_date, absences.date)
      ORDER BY
        CASE WHEN absences.status IN ('approved', 'processed') THEN 0 ELSE 1 END,
        absences.is_half_day ASC,
        absences.created_at DESC
      LIMIT 1;

      availability := 'available';
      IF absence_row.id IS NOT NULL
        AND absence_row.status IN ('approved', 'processed')
        AND absence_row.allocation_behaviour IN ('block', 'reduce') THEN
        IF absence_row.allocation_behaviour = 'block'
          OR NOT COALESCE(absence_row.is_half_day, FALSE) THEN
          availability := 'full_day_absence';
        ELSE
          availability := 'half_day_absence';
        END IF;
      END IF;

      pending_override_id := NULL;
      off_shift_override_id := NULL;
      pending_conflict_signature := private.daily_allocation_v2_conflict_signature(
        'pending_absence',
        labour_row.profile_id,
        visit_row.id,
        visit_row.work_date,
        visit_row.starts_at,
        visit_row.ends_at
      );
      off_shift_conflict_signature := private.daily_allocation_v2_conflict_signature(
        'off_shift',
        labour_row.profile_id,
        visit_row.id,
        visit_row.work_date,
        visit_row.starts_at,
        visit_row.ends_at
      );
      override_kind := NULL;
      override_evidence := NULL;
      IF pending_conflict_signature IS NOT NULL THEN
        SELECT overrides.id, overrides.conflict_kind, overrides.evidence
        INTO pending_override_id, override_kind, override_evidence
        FROM pg_temp.da2_snap_overrides overrides
        WHERE overrides.profile_id = labour_row.profile_id
          AND overrides.conflict_kind = 'pending_absence'
          AND overrides.visit_id = visit_row.id
          AND overrides.conflict_signature = pending_conflict_signature
        ORDER BY overrides.confirmed_at DESC, overrides.id
        LIMIT 1;
      END IF;
      IF off_shift_conflict_signature IS NOT NULL THEN
        SELECT overrides.id
        INTO off_shift_override_id
        FROM pg_temp.da2_snap_overrides overrides
        WHERE overrides.profile_id = labour_row.profile_id
          AND overrides.conflict_kind = 'off_shift'
          AND overrides.visit_id = visit_row.id
          AND overrides.conflict_signature = off_shift_conflict_signature
        ORDER BY overrides.confirmed_at DESC, overrides.id
        LIMIT 1;
      END IF;
      IF override_kind IS NULL AND off_shift_override_id IS NOT NULL THEN
        SELECT overrides.conflict_kind, overrides.evidence
        INTO override_kind, override_evidence
        FROM pg_temp.da2_snap_overrides overrides
        WHERE overrides.id = off_shift_override_id;
      END IF;

      INSERT INTO pg_temp.da2_snap_labour (
        visit_id, profile_id, availability, unallocated,
        job_source_type, job_source_id, job_code, site_address, customer_name, title,
        starts_at, ends_at, meeting_point, meet_person, notes,
        absence_id, absence_reason_id, absence_reason_name, absence_colour, absence_is_paid,
        absence_is_half_day, absence_half_day_session, absence_status, absence_allocation_behaviour,
        override_id, override_kind, override_evidence
      ) VALUES (
        visit_row.id,
        labour_row.profile_id,
        availability,
        FALSE,
        job_row.source_type,
        job_row.source_id,
        job_row.job_code,
        job_row.site_address,
        job_row.customer_name,
        job_row.title,
        labour_row.starts_at,
        labour_row.ends_at,
        COALESCE(labour_row.meeting_point, visit_row.meeting_point),
        COALESCE(labour_row.meet_person, visit_row.meet_person),
        COALESCE(labour_row.notes, visit_row.notes),
        absence_row.id,
        absence_row.reason_id,
        absence_row.name,
        absence_row.color,
        absence_row.is_paid,
        absence_row.is_half_day,
        absence_row.half_day_session,
        absence_row.status,
        absence_row.allocation_behaviour,
        COALESCE(pending_override_id, off_shift_override_id),
        override_kind,
        override_evidence
      );
    END LOOP;

    FOR plant_row IN
      SELECT *
      FROM public.daily_allocation_visit_plant plant
      WHERE plant.visit_id = visit_row.id
      ORDER BY plant.plant_kind, plant.plant_id, plant.hired_serial_normalized, plant.hired_company_normalized
    LOOP
      INSERT INTO pg_temp.da2_snap_plant (
        visit_id, plant_kind, plant_id, hired_serial, hired_description, hired_company,
        hired_serial_normalized, hired_company_normalized, owner_team_id,
        job_source_type, job_source_id, job_code, site_address, starts_at, ends_at, notes
      ) VALUES (
        visit_row.id,
        plant_row.plant_kind,
        plant_row.plant_id,
        plant_row.hired_serial,
        plant_row.hired_description,
        plant_row.hired_company,
        plant_row.hired_serial_normalized,
        plant_row.hired_company_normalized,
        plant_row.owner_team_id,
        job_row.source_type,
        job_row.source_id,
        job_row.job_code,
        job_row.site_address,
        plant_row.starts_at,
        plant_row.ends_at,
        plant_row.notes
      );
    END LOOP;
  END LOOP;

  FOR profile_row IN
    SELECT profiles.id, profiles.full_name
    FROM public.profiles
    WHERE profiles.id = ANY (scope_ids)
    ORDER BY profiles.full_name, profiles.id
  LOOP
    absence_row := NULL;
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
      AND plan_day.work_date >= absences.date
      AND plan_day.work_date <= COALESCE(absences.end_date, absences.date)
    ORDER BY
      CASE WHEN absences.status IN ('approved', 'processed') THEN 0 ELSE 1 END,
      absences.is_half_day ASC,
      absences.created_at DESC
    LIMIT 1;

    availability := 'available';
    IF absence_row.id IS NOT NULL
      AND absence_row.status IN ('approved', 'processed')
      AND absence_row.allocation_behaviour IN ('block', 'reduce') THEN
      IF absence_row.allocation_behaviour = 'block'
        OR NOT COALESCE(absence_row.is_half_day, FALSE) THEN
        availability := 'full_day_absence';
      ELSE
        availability := 'half_day_absence';
      END IF;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM pg_temp.da2_snap_labour labour WHERE labour.profile_id = profile_row.id AND labour.visit_id IS NOT NULL
    ) INTO assigned;

    INSERT INTO pg_temp.da2_snap_availability (
      profile_id, availability, unallocated,
      absence_id, absence_reason_id, absence_reason_name, absence_colour, absence_is_paid,
      absence_is_half_day, absence_half_day_session, absence_status, absence_allocation_behaviour
    ) VALUES (
      profile_row.id,
      availability,
      availability <> 'full_day_absence' AND NOT assigned,
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

    IF availability = 'full_day_absence' OR NOT assigned THEN
      INSERT INTO pg_temp.da2_snap_labour (
        visit_id, profile_id, availability, unallocated,
        absence_id, absence_reason_id, absence_reason_name, absence_colour, absence_is_paid,
        absence_is_half_day, absence_half_day_session, absence_status, absence_allocation_behaviour
      ) VALUES (
        NULL,
        profile_row.id,
        availability,
        availability <> 'full_day_absence',
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
    END IF;

    IF availability <> 'full_day_absence' AND NOT assigned THEN
      unallocated_count := unallocated_count + 1;
    END IF;
  END LOOP;

  IF unallocated_count > 0 AND NOT COALESCE(p_confirm_unallocated, FALSE) THEN
    RAISE EXCEPTION 'CONFIRM_UNALLOCATED_REQUIRED';
  END IF;

  SELECT COALESCE(MAX(publications.revision_no), 0) + 1
  INTO next_revision
  FROM public.daily_allocation_publications publications
  WHERE publications.work_date = plan_day.work_date;
  publication_time := NOW();

  fingerprint := private.daily_allocation_v2_plan_fingerprint(
    plan_day.id,
    plan_day.plan_version,
    scope_ids,
    COALESCE(p_confirm_unallocated, FALSE),
    BTRIM(p_idempotency_key),
    next_revision,
    actor_id,
    publication_time
  );

  PERFORM private.bump_daily_allocation_plan_version(
    plan_day.id,
    p_expected_plan_version,
    actor_id
  );

  INSERT INTO public.daily_allocation_publications (
    work_date,
    revision_no,
    idempotency_key,
    published_by,
    published_at,
    snapshot_version,
    plan_day_id,
    published_plan_version,
    confirm_unallocated,
    snapshot_fingerprint,
    scope_team_id,
    scope_profile_ids
  ) VALUES (
    plan_day.work_date,
    next_revision,
    p_idempotency_key,
    actor_id,
    publication_time,
    2,
    plan_day.id,
    plan_day.plan_version,
    COALESCE(p_confirm_unallocated, FALSE),
    fingerprint,
    plan_day.team_id,
    scope_ids
  ) RETURNING id INTO publication_id;
  v_publication_id := publication_id;

  FOR visit_row IN
    SELECT * FROM pg_temp.da2_snap_visits ORDER BY sequence_no
  LOOP
    INSERT INTO public.daily_allocation_published_visits (
      publication_id, source_visit_id, sequence_no, work_date, owner_team_id,
      job_source_type, job_source_id, job_code, site_address, customer_name, title,
      starts_at, ends_at, meeting_point, meet_person, notes
    ) VALUES (
      publication_id, visit_row.id, visit_row.sequence_no, visit_row.work_date, visit_row.owner_team_id,
      visit_row.job_source_type, visit_row.job_source_id, visit_row.job_code, visit_row.site_address,
      visit_row.customer_name, visit_row.title, visit_row.starts_at, visit_row.ends_at,
      visit_row.meeting_point, visit_row.meet_person, visit_row.notes
    ) RETURNING id INTO published_visit_id;

    INSERT INTO public.daily_allocation_published_labour (
      publication_id, published_visit_id, profile_id, availability, unallocated,
      job_source_type, job_source_id, job_code, site_address, customer_name, title,
      starts_at, ends_at, meeting_point, meet_person, notes,
      absence_id, absence_reason_id, absence_reason_name, absence_colour, absence_is_paid,
      absence_is_half_day, absence_half_day_session, absence_status, absence_allocation_behaviour,
      override_kind, override_evidence
    )
    SELECT
      publication_id, published_visit_id, labour.profile_id, labour.availability, labour.unallocated,
      labour.job_source_type, labour.job_source_id, labour.job_code, labour.site_address,
      labour.customer_name, labour.title, labour.starts_at, labour.ends_at,
      labour.meeting_point, labour.meet_person, labour.notes,
      labour.absence_id, labour.absence_reason_id, labour.absence_reason_name, labour.absence_colour,
      labour.absence_is_paid, labour.absence_is_half_day, labour.absence_half_day_session,
      labour.absence_status, labour.absence_allocation_behaviour, labour.override_kind, labour.override_evidence
    FROM pg_temp.da2_snap_labour labour
    WHERE labour.visit_id = visit_row.id
    ORDER BY labour.profile_id;

    INSERT INTO public.daily_allocation_published_plant (
      publication_id, published_visit_id, plant_kind, plant_id, hired_serial, hired_description,
      hired_company, hired_serial_normalized, hired_company_normalized, owner_team_id,
      job_source_type, job_source_id, job_code, site_address, starts_at, ends_at, notes
    )
    SELECT
      publication_id, published_visit_id, plant.plant_kind, plant.plant_id, plant.hired_serial,
      plant.hired_description, plant.hired_company, plant.hired_serial_normalized,
      plant.hired_company_normalized, plant.owner_team_id, plant.job_source_type, plant.job_source_id,
      plant.job_code, plant.site_address, plant.starts_at, plant.ends_at, plant.notes
    FROM pg_temp.da2_snap_plant plant
    WHERE plant.visit_id = visit_row.id
    ORDER BY plant.plant_kind, plant.plant_id, plant.hired_serial_normalized, plant.hired_company_normalized;
  END LOOP;

  INSERT INTO public.daily_allocation_published_labour (
    publication_id, published_visit_id, profile_id, availability, unallocated,
    absence_id, absence_reason_id, absence_reason_name, absence_colour, absence_is_paid,
    absence_is_half_day, absence_half_day_session, absence_status, absence_allocation_behaviour
  )
  SELECT
    publication_id, NULL, labour.profile_id, labour.availability, labour.unallocated,
    labour.absence_id, labour.absence_reason_id, labour.absence_reason_name, labour.absence_colour,
    labour.absence_is_paid, labour.absence_is_half_day, labour.absence_half_day_session,
    labour.absence_status, labour.absence_allocation_behaviour
  FROM pg_temp.da2_snap_labour labour
  WHERE labour.visit_id IS NULL
  ORDER BY labour.profile_id;

  INSERT INTO public.daily_allocation_published_overrides (
    publication_id, conflict_kind, profile_id, source_visit_id, plant_id, conflict_signature,
    evidence, confirmed_by, confirmed_at
  )
  SELECT
    publication_id, overrides.conflict_kind, overrides.profile_id, overrides.visit_id, overrides.plant_id,
    overrides.conflict_signature, overrides.evidence, overrides.confirmed_by, overrides.confirmed_at
  FROM pg_temp.da2_snap_overrides overrides
  ORDER BY overrides.id;

  FOR profile_row IN
    SELECT profiles.id, profiles.full_name
    FROM public.profiles
    WHERE profiles.id = ANY (scope_ids)
    ORDER BY profiles.full_name, profiles.id
  LOOP
    SELECT * INTO absence_row FROM pg_temp.da2_snap_availability WHERE profile_id = profile_row.id;
    availability := absence_row.availability;

    SELECT string_agg(
      format(
        '%s–%s %s (%s)',
        to_char(published_visits.starts_at AT TIME ZONE 'Europe/London', 'HH24:MI'),
        to_char(published_visits.ends_at AT TIME ZONE 'Europe/London', 'HH24:MI'),
        published_visits.job_code,
        published_visits.site_address
      ),
      E'\n'
      ORDER BY published_visits.sequence_no
    )
    INTO body
    FROM public.daily_allocation_published_labour published_labour
    JOIN public.daily_allocation_published_visits published_visits
      ON published_visits.id = published_labour.published_visit_id
    WHERE published_labour.publication_id = v_publication_id
      AND published_labour.profile_id = profile_row.id
      AND published_labour.published_visit_id IS NOT NULL;

    IF availability = 'full_day_absence' THEN
      body := format(
        'You are recorded as %s on %s. Do not attend site unless your manager contacts you.',
        COALESCE(absence_row.absence_reason_name, 'leave'),
        plan_day.work_date::TEXT
      );
    ELSIF body IS NULL THEN
      body := format(
        'You are unallocated on %s. Stay available unless your manager contacts you.',
        plan_day.work_date::TEXT
      );
    ELSE
      body := format('Allocation for %s%s%s', plan_day.work_date::TEXT, E'\n', body);
    END IF;

    INSERT INTO public.messages (
      type,
      subject,
      body,
      priority,
      sender_id,
      created_via,
      module_key,
      daily_allocation_publication_id
    ) VALUES (
      'NOTIFICATION',
      format('Your allocation for %s', plan_day.work_date::TEXT),
      body,
      'LOW',
      actor_id,
      'daily_allocation_publish_v2',
      'daily_allocation',
      publication_id
    ) RETURNING id INTO message_id;

    INSERT INTO public.daily_allocation_publication_notifications (
      publication_id,
      profile_id,
      message_id
    ) VALUES (
      publication_id,
      profile_row.id,
      message_id
    );

    INSERT INTO public.message_recipients (message_id, user_id, status)
    VALUES (message_id, profile_row.id, 'PENDING');
  END LOOP;

  persisted_fingerprint := private.daily_allocation_v2_persisted_fingerprint(publication_id);
  IF persisted_fingerprint IS DISTINCT FROM fingerprint THEN
    RAISE EXCEPTION 'SNAPSHOT_FINGERPRINT_MISMATCH';
  END IF;

  RETURN publication_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.move_daily_allocation_visit_v2(
  p_visit_id UUID,
  p_target_plan_day_id UUID,
  p_expected_source_plan_version INTEGER,
  p_expected_target_plan_version INTEGER,
  p_expected_row_version INTEGER,
  p_starts_at TIMESTAMPTZ,
  p_ends_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_id UUID;
  visit_row public.daily_allocation_visits%ROWTYPE;
  source_plan public.daily_allocation_plan_days%ROWTYPE;
  target_plan public.daily_allocation_plan_days%ROWTYPE;
  first_plan public.daily_allocation_plan_days%ROWTYPE;
  second_plan public.daily_allocation_plan_days%ROWTYPE;
  source_version INTEGER;
  target_version INTEGER;
BEGIN
  actor_id := private.require_daily_allocation_v2_writer();
  SELECT * INTO visit_row FROM public.daily_allocation_visits WHERE id = p_visit_id;
  IF visit_row.id IS NULL THEN
    RAISE EXCEPTION 'Visit not found';
  END IF;
  SELECT * INTO source_plan FROM public.daily_allocation_plan_days WHERE id = visit_row.plan_day_id;
  SELECT * INTO target_plan FROM public.daily_allocation_plan_days WHERE id = p_target_plan_day_id;
  IF source_plan.id IS NULL OR target_plan.id IS NULL THEN
    RAISE EXCEPTION 'Plan day not found';
  END IF;
  IF source_plan.id = target_plan.id THEN
    RAISE EXCEPTION 'Use upsert for same-plan visit changes';
  END IF;
  IF NOT public.can_actor_manage_daily_allocation_team(source_plan.team_id)
    OR NOT public.can_actor_manage_daily_allocation_team(target_plan.team_id) THEN
    RAISE EXCEPTION 'Not allowed to change this daily allocation plan';
  END IF;
  IF NOT private.daily_allocation_interval_is_valid(target_plan.work_date, p_starts_at, p_ends_at) THEN
    RAISE EXCEPTION 'Invalid visit interval';
  END IF;

  IF (source_plan.work_date, source_plan.team_id, source_plan.id)
      <= (target_plan.work_date, target_plan.team_id, target_plan.id) THEN
    first_plan := source_plan;
    second_plan := target_plan;
  ELSE
    first_plan := target_plan;
    second_plan := source_plan;
  END IF;

  PERFORM private.lock_daily_allocation_plan_day(first_plan.work_date, first_plan.team_id);
  PERFORM private.lock_daily_allocation_plan_day(second_plan.work_date, second_plan.team_id);
  PERFORM private.lock_daily_allocation_visit_resources(p_visit_id);
  PERFORM private.daily_allocation_v2_lock_job_source(visit_row.job_source_type, visit_row.job_source_id);

  SELECT * INTO visit_row FROM public.daily_allocation_visits WHERE id = p_visit_id;
  SELECT * INTO source_plan FROM public.daily_allocation_plan_days WHERE id = visit_row.plan_day_id;
  SELECT * INTO target_plan FROM public.daily_allocation_plan_days WHERE id = p_target_plan_day_id;

  IF visit_row.row_version <> p_expected_row_version THEN
    RAISE EXCEPTION 'STALE_ENTITY_VERSION';
  END IF;
  IF source_plan.plan_version <> p_expected_source_plan_version
    OR target_plan.plan_version <> p_expected_target_plan_version THEN
    RAISE EXCEPTION 'STALE_PLAN_VERSION';
  END IF;

  source_version := private.bump_daily_allocation_plan_version(
    source_plan.id,
    p_expected_source_plan_version,
    actor_id
  );
  target_version := private.bump_daily_allocation_plan_version(
    target_plan.id,
    p_expected_target_plan_version,
    actor_id
  );

  UPDATE public.daily_allocation_visits
  SET
    plan_day_id = target_plan.id,
    work_date = target_plan.work_date,
    owner_team_id = target_plan.team_id,
    starts_at = p_starts_at,
    ends_at = p_ends_at,
    row_version = row_version + 1,
    updated_by = actor_id
  WHERE id = p_visit_id
    AND row_version = p_expected_row_version
  RETURNING * INTO visit_row;
  IF visit_row.id IS NULL THEN
    RAISE EXCEPTION 'STALE_ENTITY_VERSION';
  END IF;

  RETURN jsonb_build_object(
    'visit_id', visit_row.id,
    'plan_day_id', visit_row.plan_day_id,
    'source_plan_day_id', source_plan.id,
    'source_plan_version', source_version,
    'target_plan_day_id', target_plan.id,
    'target_plan_version', target_version,
    'plan_version', target_version,
    'visit', jsonb_build_object(
      'id', visit_row.id,
      'plan_day_id', visit_row.plan_day_id,
      'work_date', visit_row.work_date,
      'owner_team_id', visit_row.owner_team_id,
      'job_source_type', visit_row.job_source_type,
      'job_source_id', visit_row.job_source_id,
      'job_code', visit_row.job_code,
      'site_address', visit_row.site_address,
      'starts_at', visit_row.starts_at,
      'ends_at', visit_row.ends_at,
      'meeting_point', visit_row.meeting_point,
      'meet_person', visit_row.meet_person,
      'notes', visit_row.notes,
      'row_version', visit_row.row_version,
      'updated_at', visit_row.updated_at
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_daily_allocation_conflict_override_v2(
  p_plan_day_id UUID,
  p_expected_plan_version INTEGER,
  p_conflict_kind TEXT,
  p_evidence TEXT,
  p_visit_id UUID DEFAULT NULL,
  p_profile_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_id UUID;
  plan_day public.daily_allocation_plan_days%ROWTYPE;
  visit_row public.daily_allocation_visits%ROWTYPE;
  override_id UUID;
  conflict_signature TEXT;
BEGIN
  actor_id := private.require_daily_allocation_v2_writer();
  IF p_conflict_kind NOT IN ('pending_absence', 'off_shift') THEN
    RAISE EXCEPTION 'HARD_CONFLICT';
  END IF;
  IF NULLIF(BTRIM(p_evidence), '') IS NULL THEN
    RAISE EXCEPTION 'Override evidence is required';
  END IF;
  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'Override subject is required';
  END IF;
  IF NOT public.can_actor_manage_daily_allocation(p_profile_id) THEN
    RAISE EXCEPTION 'Not allowed to change this labour allocation';
  END IF;

  SELECT * INTO plan_day FROM public.daily_allocation_plan_days WHERE id = p_plan_day_id;
  IF plan_day.id IS NULL THEN
    RAISE EXCEPTION 'Plan day not found';
  END IF;
  IF NOT public.can_actor_manage_daily_allocation_team(plan_day.team_id) THEN
    RAISE EXCEPTION 'Not allowed to change this daily allocation plan';
  END IF;

  IF p_visit_id IS NULL THEN
    RAISE EXCEPTION 'Conflict override requires a visit';
  END IF;
  SELECT * INTO visit_row FROM public.daily_allocation_visits WHERE id = p_visit_id;
  IF visit_row.id IS NULL OR visit_row.plan_day_id <> p_plan_day_id THEN
    RAISE EXCEPTION 'Visit not found';
  END IF;

  PERFORM private.lock_daily_allocation_plan_day(plan_day.work_date, plan_day.team_id);
  PERFORM private.lock_daily_allocation_resource_keys(
    ARRAY[p_profile_id],
    ARRAY[]::UUID[],
    ARRAY[]::TEXT[]
  );
  SELECT * INTO plan_day FROM public.daily_allocation_plan_days WHERE id = p_plan_day_id;
  SELECT * INTO visit_row FROM public.daily_allocation_visits WHERE id = p_visit_id;
  IF visit_row.id IS NULL OR visit_row.plan_day_id <> p_plan_day_id THEN
    RAISE EXCEPTION 'Visit not found';
  END IF;

  conflict_signature := private.daily_allocation_v2_conflict_signature(
    p_conflict_kind,
    p_profile_id,
    p_visit_id,
    visit_row.work_date,
    visit_row.starts_at,
    visit_row.ends_at
  );
  IF conflict_signature IS NULL THEN
    RAISE EXCEPTION 'CONFLICT_NOT_PRESENT';
  END IF;

  PERFORM private.bump_daily_allocation_plan_version(
    plan_day.id,
    p_expected_plan_version,
    actor_id
  );

  INSERT INTO public.daily_allocation_conflict_overrides (
    plan_day_id,
    visit_id,
    profile_id,
    conflict_kind,
    conflict_signature,
    evidence,
    confirmed_by,
    confirmed_at
  ) VALUES (
    p_plan_day_id,
    p_visit_id,
    p_profile_id,
    p_conflict_kind,
    conflict_signature,
    BTRIM(p_evidence),
    actor_id,
    NOW()
  ) RETURNING id INTO override_id;

  RETURN override_id;
END;
$$;

REVOKE ALL ON FUNCTION public.convert_daily_allocation_plan_day_v2(DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.convert_daily_allocation_plan_day_v2(DATE, TEXT) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.upsert_daily_allocation_visit_v2(UUID, UUID, INTEGER, INTEGER, TEXT, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_daily_allocation_visit_v2(UUID, UUID, INTEGER, INTEGER, TEXT, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.delete_daily_allocation_visit_v2(UUID, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_daily_allocation_visit_v2(UUID, INTEGER, INTEGER) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.assign_daily_allocation_labour_v2(UUID, UUID, INTEGER, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_daily_allocation_labour_v2(UUID, UUID, INTEGER, TEXT, TEXT, TEXT, UUID) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.unassign_daily_allocation_labour_v2(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unassign_daily_allocation_labour_v2(UUID, INTEGER) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.assign_daily_allocation_plant_v2(UUID, INTEGER, TEXT, UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_daily_allocation_plant_v2(UUID, INTEGER, TEXT, UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.unassign_daily_allocation_plant_v2(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unassign_daily_allocation_plant_v2(UUID, INTEGER) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.publish_daily_allocation_plan_v2(UUID, INTEGER, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_daily_allocation_plan_v2(UUID, INTEGER, TEXT, BOOLEAN) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.move_daily_allocation_visit_v2(UUID, UUID, INTEGER, INTEGER, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.move_daily_allocation_visit_v2(UUID, UUID, INTEGER, INTEGER, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_daily_allocation_conflict_override_v2(UUID, INTEGER, TEXT, TEXT, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_daily_allocation_conflict_override_v2(UUID, INTEGER, TEXT, TEXT, UUID, UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS: preserve current effective permission boundaries. No user metadata.
-- ---------------------------------------------------------------------------

ALTER TABLE public.daily_allocation_plan_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_allocation_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_allocation_visit_labour ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_allocation_visit_plant ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_allocation_conflict_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_allocation_published_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_allocation_published_labour ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_allocation_published_plant ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_allocation_published_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_allocation_publication_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_allocation_plan_days_select ON public.daily_allocation_plan_days;
CREATE POLICY daily_allocation_plan_days_select ON public.daily_allocation_plan_days
  FOR SELECT TO authenticated
  USING (
    public.effective_module_access_level('daily-allocation') >= 5
    OR public.can_actor_manage_daily_allocation_team(team_id)
  );

DROP POLICY IF EXISTS daily_allocation_plan_days_write ON public.daily_allocation_plan_days;
DROP POLICY IF EXISTS daily_allocation_plan_days_update ON public.daily_allocation_plan_days;

DROP POLICY IF EXISTS daily_allocation_visits_select ON public.daily_allocation_visits;
CREATE POLICY daily_allocation_visits_select ON public.daily_allocation_visits
  FOR SELECT TO authenticated
  USING (
    public.effective_module_access_level('daily-allocation') >= 5
    OR public.can_actor_manage_daily_allocation_team(owner_team_id)
  );

DROP POLICY IF EXISTS daily_allocation_visits_write ON public.daily_allocation_visits;

DROP POLICY IF EXISTS daily_allocation_visit_labour_select ON public.daily_allocation_visit_labour;
CREATE POLICY daily_allocation_visit_labour_select ON public.daily_allocation_visit_labour
  FOR SELECT TO authenticated
  USING (public.can_actor_manage_daily_allocation(profile_id));

DROP POLICY IF EXISTS daily_allocation_visit_labour_write ON public.daily_allocation_visit_labour;

DROP POLICY IF EXISTS daily_allocation_visit_plant_select ON public.daily_allocation_visit_plant;
CREATE POLICY daily_allocation_visit_plant_select ON public.daily_allocation_visit_plant
  FOR SELECT TO authenticated
  USING (
    public.effective_module_access_level('daily-allocation') >= 5
    OR (
      public.effective_has_module_level('daily-allocation', 4)
      AND public.can_actor_manage_daily_allocation_team(owner_team_id)
    )
  );

DROP POLICY IF EXISTS daily_allocation_visit_plant_write ON public.daily_allocation_visit_plant;

DROP POLICY IF EXISTS daily_allocation_conflict_overrides_select ON public.daily_allocation_conflict_overrides;
CREATE POLICY daily_allocation_conflict_overrides_select ON public.daily_allocation_conflict_overrides
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.daily_allocation_plan_days plan_days
      WHERE plan_days.id = daily_allocation_conflict_overrides.plan_day_id
        AND (
          public.effective_module_access_level('daily-allocation') >= 5
          OR public.can_actor_manage_daily_allocation_team(plan_days.team_id)
        )
    )
  );

DROP POLICY IF EXISTS daily_allocation_conflict_overrides_write ON public.daily_allocation_conflict_overrides;

DROP POLICY IF EXISTS daily_allocation_published_visits_select ON public.daily_allocation_published_visits;
CREATE POLICY daily_allocation_published_visits_select ON public.daily_allocation_published_visits
  FOR SELECT TO authenticated
  USING (
    public.effective_module_access_level('daily-allocation') >= 5
    OR public.can_actor_manage_daily_allocation_team(owner_team_id)
    OR EXISTS (
      SELECT 1
      FROM public.daily_allocation_published_labour labour
      WHERE labour.published_visit_id = daily_allocation_published_visits.id
        AND public.can_actor_view_daily_allocation(labour.profile_id)
    )
  );

DROP POLICY IF EXISTS daily_allocation_published_labour_select ON public.daily_allocation_published_labour;
CREATE POLICY daily_allocation_published_labour_select ON public.daily_allocation_published_labour
  FOR SELECT TO authenticated
  USING (public.can_actor_view_daily_allocation(profile_id));

-- Additive v2 read path: employees and managers can SELECT publication headers
-- for snapshots they already see in published_labour. v1 branches stay intact.
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
    OR EXISTS (
      SELECT 1
      FROM public.daily_allocation_published_labour labour
      WHERE labour.publication_id = daily_allocation_publications.id
        AND labour.profile_id = auth.uid()
        AND public.effective_has_module_level('daily-allocation', 2)
    )
    OR EXISTS (
      SELECT 1
      FROM public.daily_allocation_published_labour labour
      WHERE labour.publication_id = daily_allocation_publications.id
        AND public.can_actor_manage_daily_allocation(labour.profile_id)
    )
  );

DROP POLICY IF EXISTS daily_allocation_published_plant_select ON public.daily_allocation_published_plant;
CREATE POLICY daily_allocation_published_plant_select ON public.daily_allocation_published_plant
  FOR SELECT TO authenticated
  USING (
    public.effective_module_access_level('daily-allocation') >= 5
    OR EXISTS (
      SELECT 1
      FROM public.daily_allocation_publications publications
      WHERE publications.id = daily_allocation_published_plant.publication_id
        AND (
          public.can_actor_manage_daily_allocation_team(daily_allocation_published_plant.owner_team_id)
          OR publications.published_by = auth.uid()
        )
        AND public.effective_has_module_level('daily-allocation', 4)
    )
  );

DROP POLICY IF EXISTS daily_allocation_published_overrides_select ON public.daily_allocation_published_overrides;
CREATE POLICY daily_allocation_published_overrides_select ON public.daily_allocation_published_overrides
  FOR SELECT TO authenticated
  USING (
    public.effective_has_module_level('daily-allocation', 4)
    AND EXISTS (
      SELECT 1
      FROM public.daily_allocation_publications publications
      WHERE publications.id = daily_allocation_published_overrides.publication_id
        AND (
          public.effective_module_access_level('daily-allocation') >= 5
          OR public.can_actor_manage_daily_allocation_team(publications.scope_team_id)
          OR publications.published_by = auth.uid()
        )
    )
  );


DROP POLICY IF EXISTS daily_allocation_publications_insert ON public.daily_allocation_publications;
CREATE POLICY daily_allocation_publications_insert ON public.daily_allocation_publications
  FOR INSERT TO authenticated
  WITH CHECK (
    COALESCE(snapshot_version, 1) = 1
    AND public.effective_has_module_level('daily-allocation', 4)
  );

GRANT INSERT ON TABLE public.daily_allocation_publications TO authenticated;

DROP POLICY IF EXISTS daily_allocation_publication_notifications_select
  ON public.daily_allocation_publication_notifications;
CREATE POLICY daily_allocation_publication_notifications_select
  ON public.daily_allocation_publication_notifications
  FOR SELECT TO authenticated
  USING (public.can_actor_view_daily_allocation(profile_id));

REVOKE ALL ON TABLE public.daily_allocation_plan_days FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.daily_allocation_visits FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.daily_allocation_visit_labour FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.daily_allocation_visit_plant FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.daily_allocation_conflict_overrides FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.daily_allocation_published_visits FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.daily_allocation_published_labour FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.daily_allocation_published_plant FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.daily_allocation_published_overrides FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.daily_allocation_publication_notifications FROM PUBLIC, anon;

GRANT SELECT ON TABLE public.daily_allocation_plan_days TO authenticated;
GRANT SELECT ON TABLE public.daily_allocation_visits TO authenticated;
GRANT SELECT ON TABLE public.daily_allocation_visit_labour TO authenticated;
GRANT SELECT ON TABLE public.daily_allocation_visit_plant TO authenticated;
GRANT SELECT ON TABLE public.daily_allocation_conflict_overrides TO authenticated;
GRANT SELECT ON TABLE public.daily_allocation_published_visits TO authenticated;
GRANT SELECT ON TABLE public.daily_allocation_published_labour TO authenticated;
GRANT SELECT ON TABLE public.daily_allocation_published_plant TO authenticated;
GRANT SELECT ON TABLE public.daily_allocation_published_overrides TO authenticated;
GRANT SELECT ON TABLE public.daily_allocation_publication_notifications TO authenticated;

COMMIT;
