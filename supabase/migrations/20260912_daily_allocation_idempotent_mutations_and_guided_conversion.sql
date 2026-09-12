-- finalise-phase: predeploy
-- DAFP data-contract foundation: immutable request replay, assignment CAS,
-- and explicit/fingerprinted v1-to-v2 conversion. Runtime flags remain closed.
BEGIN;

CREATE TABLE IF NOT EXISTS private.daily_allocation_mutation_requests (
  request_id UUID PRIMARY KEY,
  actor_id UUID NOT NULL,
  action TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT daily_allocation_mutation_requests_action_check CHECK (
    action IN (
      'convert',
      'visit_upsert',
      'visit_move',
      'visit_delete',
      'labour_assign',
      'labour_unassign',
      'plant_assign',
      'plant_unassign',
      'override_create',
      'publish'
    )
  ),
  CONSTRAINT daily_allocation_mutation_requests_hash_check
    CHECK (payload_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS daily_allocation_mutation_requests_created_idx
  ON private.daily_allocation_mutation_requests (created_at DESC);

ALTER TABLE private.daily_allocation_mutation_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.daily_allocation_mutation_requests
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.guard_daily_allocation_request_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'Daily allocation mutation requests are immutable';
END;
$$;

DROP TRIGGER IF EXISTS daily_allocation_mutation_requests_immutable
  ON private.daily_allocation_mutation_requests;
CREATE TRIGGER daily_allocation_mutation_requests_immutable
  BEFORE UPDATE OR DELETE ON private.daily_allocation_mutation_requests
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_daily_allocation_request_immutable();

CREATE OR REPLACE FUNCTION private.daily_allocation_semantic_hash(p_payload JSONB)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public, extensions
AS $$
  SELECT ENCODE(
    digest(
      CONVERT_TO(COALESCE(p_payload, 'null'::JSONB)::TEXT, 'utf8'),
      'sha256'
    ),
    'hex'
  );
$$;

CREATE OR REPLACE FUNCTION private.daily_allocation_request_replay(
  p_request_id UUID,
  p_actor_id UUID,
  p_action TEXT,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $$
DECLARE
  existing private.daily_allocation_mutation_requests%ROWTYPE;
  expected_hash TEXT;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'REQUEST_ID_REQUIRED';
  END IF;
  expected_hash := private.daily_allocation_semantic_hash(p_payload);
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('daily-allocation-request:' || p_request_id::TEXT, 0)
  );

  SELECT requests.*
  INTO existing
  FROM private.daily_allocation_mutation_requests requests
  WHERE requests.request_id = p_request_id;

  IF FOUND THEN
    IF existing.actor_id IS DISTINCT FROM p_actor_id
      OR existing.action IS DISTINCT FROM p_action
      OR existing.payload_hash IS DISTINCT FROM expected_hash THEN
      RAISE EXCEPTION 'REQUEST_ID_REUSED';
    END IF;
    RETURN existing.result;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION private.daily_allocation_request_store(
  p_request_id UUID,
  p_actor_id UUID,
  p_action TEXT,
  p_payload JSONB,
  p_result JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $$
BEGIN
  INSERT INTO private.daily_allocation_mutation_requests (
    request_id,
    actor_id,
    action,
    payload_hash,
    result
  ) VALUES (
    p_request_id,
    p_actor_id,
    p_action,
    private.daily_allocation_semantic_hash(p_payload),
    p_result
  );
  RETURN p_result;
END;
$$;

CREATE OR REPLACE FUNCTION private.daily_allocation_conversion_source_payload(
  p_work_date DATE,
  p_team_id TEXT
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT JSONB_BUILD_OBJECT(
    'work_date', p_work_date,
    'team_id', p_team_id,
    'labour', COALESCE((
      SELECT JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'id', drafts.id,
          'row_version', drafts.row_version,
          'profile_id', drafts.profile_id,
          'job_source_type', drafts.job_source_type,
          'job_source_id', drafts.job_source_id,
          'job_code', drafts.job_code,
          'site_address', drafts.site_address,
          'meeting_point', drafts.meeting_point,
          'meet_person', drafts.meet_person,
          'notes', drafts.notes
        )
        ORDER BY drafts.id
      )
      FROM public.daily_labour_allocation_drafts drafts
      JOIN public.profiles profiles ON profiles.id = drafts.profile_id
      WHERE drafts.work_date = p_work_date
        AND profiles.team_id = p_team_id
    ), '[]'::JSONB),
    'plant', COALESCE((
      SELECT JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'id', drafts.id,
          'row_version', drafts.row_version,
          'plant_kind', drafts.plant_kind,
          'plant_id', drafts.plant_id,
          'hired_serial', drafts.hired_serial,
          'hired_description', drafts.hired_description,
          'hired_company', drafts.hired_company,
          'owner_team_id', drafts.owner_team_id,
          'job_source_type', drafts.job_source_type,
          'job_source_id', drafts.job_source_id,
          'job_code', drafts.job_code,
          'site_address', drafts.site_address,
          'notes', drafts.notes
        )
        ORDER BY drafts.id
      )
      FROM public.daily_plant_allocation_drafts drafts
      WHERE drafts.work_date = p_work_date
        AND drafts.owner_team_id = p_team_id
    ), '[]'::JSONB)
  );
$$;

CREATE OR REPLACE FUNCTION private.daily_allocation_conversion_source_fingerprint(
  p_work_date DATE,
  p_team_id TEXT
)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $$
  SELECT private.daily_allocation_semantic_hash(
    private.daily_allocation_conversion_source_payload(p_work_date, p_team_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.get_daily_allocation_conversion_source_v2(
  p_work_date DATE,
  p_team_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  actor_id UUID;
  source_payload JSONB;
BEGIN
  actor_id := private.require_daily_allocation_v2_writer();
  IF NOT public.can_actor_manage_daily_allocation_team(p_team_id) THEN
    RAISE EXCEPTION 'Not allowed to convert this daily allocation plan';
  END IF;
  source_payload := private.daily_allocation_conversion_source_payload(p_work_date, p_team_id);
  RETURN JSONB_BUILD_OBJECT(
    'work_date', p_work_date,
    'team_id', p_team_id,
    'source_fingerprint', private.daily_allocation_semantic_hash(source_payload),
    'labour_drafts', COALESCE(source_payload->'labour', '[]'::JSONB),
    'plant_drafts', COALESCE(source_payload->'plant', '[]'::JSONB)
  );
END;
$$;

-- Every v1 draft mutation now takes the same team/date lock as conversion
-- before checking whether the scope has converted.
CREATE OR REPLACE FUNCTION private.guard_daily_labour_allocation_draft_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job private.allocation_job;
  old_team_id TEXT;
  new_team_id TEXT;
BEGIN
  IF public.view_as_role_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Daily allocation cannot be changed while viewing as another role';
  END IF;

  IF TG_OP <> 'INSERT' THEN
    SELECT team_id INTO old_team_id FROM public.profiles WHERE id = OLD.profile_id;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    SELECT team_id INTO new_team_id FROM public.profiles WHERE id = NEW.profile_id;
  END IF;

  IF TG_OP = 'UPDATE'
    AND (OLD.work_date, COALESCE(old_team_id, '')) > (NEW.work_date, COALESCE(new_team_id, '')) THEN
    PERFORM private.lock_daily_allocation_plan_day(NEW.work_date, new_team_id);
    PERFORM private.lock_daily_allocation_plan_day(OLD.work_date, old_team_id);
  ELSE
    IF TG_OP <> 'INSERT' THEN
      PERFORM private.lock_daily_allocation_plan_day(OLD.work_date, old_team_id);
    END IF;
    IF TG_OP <> 'DELETE'
      AND (TG_OP <> 'UPDATE' OR (OLD.work_date, old_team_id) IS DISTINCT FROM (NEW.work_date, new_team_id)) THEN
      PERFORM private.lock_daily_allocation_plan_day(NEW.work_date, new_team_id);
    END IF;
  END IF;

  IF TG_OP <> 'INSERT' THEN
    PERFORM private.reject_converted_v1_daily_allocation_write(OLD.work_date, old_team_id);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM private.reject_converted_v1_daily_allocation_write(NEW.work_date, new_team_id);
  END IF;

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
    v_job := private.apply_allocation_job_fields(
      NEW.job_source_type, NEW.job_source_id, NEW.job_code, TRUE
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
  ELSE
    NEW.created_by := COALESCE(NEW.created_by, auth.uid());
  END IF;
  NEW.updated_by := auth.uid();
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

  IF TG_OP = 'INSERT' AND (
    public.effective_module_access_level('daily-allocation') < 5
    OR NEW.owner_team_id IS NULL
  ) THEN
    SELECT team_id INTO NEW.owner_team_id FROM public.profiles WHERE id = auth.uid();
  END IF;

  IF TG_OP = 'UPDATE'
    AND (OLD.work_date, COALESCE(OLD.owner_team_id, ''))
      > (NEW.work_date, COALESCE(NEW.owner_team_id, '')) THEN
    PERFORM private.lock_daily_allocation_plan_day(NEW.work_date, NEW.owner_team_id);
    PERFORM private.lock_daily_allocation_plan_day(OLD.work_date, OLD.owner_team_id);
  ELSE
    IF TG_OP <> 'INSERT' THEN
      PERFORM private.lock_daily_allocation_plan_day(OLD.work_date, OLD.owner_team_id);
    END IF;
    IF TG_OP <> 'DELETE'
      AND (TG_OP <> 'UPDATE'
        OR (OLD.work_date, OLD.owner_team_id) IS DISTINCT FROM (NEW.work_date, NEW.owner_team_id)) THEN
      PERFORM private.lock_daily_allocation_plan_day(NEW.work_date, NEW.owner_team_id);
    END IF;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    PERFORM private.reject_converted_v1_daily_allocation_write(OLD.work_date, OLD.owner_team_id);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM private.reject_converted_v1_daily_allocation_write(NEW.work_date, NEW.owner_team_id);
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
    IF NOT public.can_actor_manage_daily_allocation_team(NEW.owner_team_id)
      AND public.effective_module_access_level('daily-allocation') < 5 THEN
      RAISE EXCEPTION 'Not allowed to allocate plant';
    END IF;
    NEW.created_by := COALESCE(NEW.created_by, auth.uid());
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

  v_job := private.apply_allocation_job_fields(
    NEW.job_source_type, NEW.job_source_id, NEW.job_code, TRUE
  );
  NEW.job_source_type := v_job.source_type;
  NEW.job_source_id := v_job.source_id;
  NEW.job_code := v_job.job_code;
  NEW.site_address := v_job.site_address;
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$;

-- The publication trigger holds the team/date lock through both publication
-- triggers, so v1 snapshots cannot race guided conversion.
CREATE OR REPLACE FUNCTION private.prepare_daily_allocation_publication()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_id UUID := auth.uid();
  actor_team_id TEXT;
  plan_team_id TEXT;
  managed_team_id TEXT;
  next_revision INTEGER;
BEGIN
  IF actor_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF public.view_as_role_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Daily allocation cannot be published while viewing as another role';
  END IF;
  IF NOT public.effective_has_module_level('daily-allocation', 4) THEN
    RAISE EXCEPTION 'Manager-level daily allocation access is required to publish';
  END IF;

  SELECT team_id INTO actor_team_id FROM public.profiles WHERE id = actor_id;

  NEW.snapshot_version := COALESCE(NEW.snapshot_version, 1);
  IF NEW.snapshot_version NOT IN (1, 2) THEN
    RAISE EXCEPTION 'Unsupported daily allocation snapshot version';
  END IF;
  SELECT COALESCE(MAX(revision_no), 0) + 1 INTO next_revision
  FROM public.daily_allocation_publications
  WHERE work_date = NEW.work_date;
  NEW.id := COALESCE(NEW.id, gen_random_uuid());
  NEW.revision_no := next_revision;
  NEW.published_by := actor_id;
  NEW.published_at := NOW();
  NEW.idempotency_key := NULLIF(BTRIM(NEW.idempotency_key), '');
  IF NEW.idempotency_key IS NULL THEN RAISE EXCEPTION 'Idempotency key is required'; END IF;

  IF NEW.snapshot_version = 2 THEN
    IF NOT private.daily_allocation_v2_writes_allowed() THEN RAISE EXCEPTION 'V2_DISABLED'; END IF;
    IF NEW.plan_day_id IS NULL THEN RAISE EXCEPTION 'V2 publication requires a converted plan day'; END IF;
    SELECT plan_days.team_id INTO plan_team_id
    FROM public.daily_allocation_plan_days plan_days
    WHERE plan_days.id = NEW.plan_day_id
      AND plan_days.work_date = NEW.work_date;
    IF plan_team_id IS NULL THEN
      RAISE EXCEPTION 'V2 publication requires a matching converted plan day';
    END IF;
    IF NEW.scope_team_id IS NOT NULL AND NEW.scope_team_id <> plan_team_id THEN
      RAISE EXCEPTION 'V2 publication team does not match its plan day';
    END IF;
    PERFORM private.lock_daily_allocation_plan_day(NEW.work_date, plan_team_id);
    NEW.scope_team_id := plan_team_id;
    IF NEW.scope_profile_ids IS NULL THEN NEW.scope_profile_ids := ARRAY[]::UUID[]; END IF;
    RETURN NEW;
  END IF;

  NEW.scope_team_id := actor_team_id;
  SELECT COALESCE(ARRAY_AGG(profiles.id), ARRAY[]::UUID[]) INTO NEW.scope_profile_ids
  FROM public.profiles
  WHERE public.can_actor_manage_daily_allocation(profiles.id)
    AND COALESCE(profiles.is_placeholder, FALSE) = FALSE
    AND NOT private.is_hidden_daily_allocation_profile(profiles.employee_id, profiles.full_name);
  IF NEW.scope_profile_ids IS NULL OR ARRAY_LENGTH(NEW.scope_profile_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'No employees are in scope for this publication';
  END IF;
  FOR managed_team_id IN
    SELECT DISTINCT profiles.team_id
    FROM public.profiles
    WHERE profiles.id = ANY(NEW.scope_profile_ids)
      AND profiles.team_id IS NOT NULL
    ORDER BY profiles.team_id
  LOOP
    PERFORM private.lock_daily_allocation_plan_day(NEW.work_date, managed_team_id);
    PERFORM private.reject_converted_v1_daily_allocation_write(
      NEW.work_date,
      managed_team_id
    );
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.convert_daily_allocation_plan_day_v2(
  p_request_id UUID,
  p_work_date DATE,
  p_team_id TEXT,
  p_expected_source_fingerprint TEXT,
  p_visits JSONB,
  p_labour_drafts JSONB,
  p_plant_drafts JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
DECLARE
  actor_id UUID;
  payload JSONB;
  replay JSONB;
  result JSONB;
  actual_fingerprint TEXT;
  plan_day public.daily_allocation_plan_days%ROWTYPE;
  visit_input JSONB;
  labour_input JSONB;
  plant_input JSONB;
  labour_row public.daily_labour_allocation_drafts%ROWTYPE;
  plant_row public.daily_plant_allocation_drafts%ROWTYPE;
  visit_row public.daily_allocation_visits%ROWTYPE;
  job_row private.allocation_job;
  visit_job private.allocation_job;
  profile_ids UUID[];
  plant_ids UUID[];
  hired_keys TEXT[];
  job_input RECORD;
BEGIN
  actor_id := private.require_daily_allocation_v2_writer();
  IF NOT public.can_actor_manage_daily_allocation_team(p_team_id) THEN
    RAISE EXCEPTION 'Not allowed to convert this daily allocation plan';
  END IF;
  IF JSONB_TYPEOF(COALESCE(p_visits, 'null'::JSONB)) <> 'array'
    OR JSONB_TYPEOF(COALESCE(p_labour_drafts, 'null'::JSONB)) <> 'array'
    OR JSONB_TYPEOF(COALESCE(p_plant_drafts, 'null'::JSONB)) <> 'array' THEN
    RAISE EXCEPTION 'CONVERSION_INVALID';
  END IF;

  payload := JSONB_BUILD_OBJECT(
    'work_date', p_work_date,
    'team_id', p_team_id,
    'expected_source_fingerprint', LOWER(p_expected_source_fingerprint),
    'visits', COALESCE((
      SELECT JSONB_AGG(value ORDER BY value->>'visit_id')
      FROM JSONB_ARRAY_ELEMENTS(p_visits)
    ), '[]'::JSONB),
    'labour_drafts', COALESCE((
      SELECT JSONB_AGG(value ORDER BY value->>'draft_id')
      FROM JSONB_ARRAY_ELEMENTS(p_labour_drafts)
    ), '[]'::JSONB),
    'plant_drafts', COALESCE((
      SELECT JSONB_AGG(value ORDER BY value->>'draft_id')
      FROM JSONB_ARRAY_ELEMENTS(p_plant_drafts)
    ), '[]'::JSONB)
  );
  replay := private.daily_allocation_request_replay(
    p_request_id, actor_id, 'convert', payload
  );
  IF replay IS NOT NULL THEN RETURN replay; END IF;

  PERFORM private.lock_daily_allocation_plan_day(p_work_date, p_team_id);
  IF EXISTS (
    SELECT 1 FROM public.daily_allocation_plan_days
    WHERE work_date = p_work_date AND team_id = p_team_id
  ) THEN
    RAISE EXCEPTION 'V1_WRITES_DISABLED';
  END IF;

  actual_fingerprint := private.daily_allocation_conversion_source_fingerprint(
    p_work_date, p_team_id
  );
  IF p_expected_source_fingerprint IS NULL
    OR LOWER(p_expected_source_fingerprint) !~ '^[0-9a-f]{64}$'
    OR actual_fingerprint IS DISTINCT FROM LOWER(p_expected_source_fingerprint) THEN
    RAISE EXCEPTION 'SOURCE_FINGERPRINT_MISMATCH';
  END IF;

  IF (SELECT COUNT(*) FROM JSONB_ARRAY_ELEMENTS(p_visits))
    <> (SELECT COUNT(DISTINCT value->>'visit_id') FROM JSONB_ARRAY_ELEMENTS(p_visits))
    OR (SELECT COUNT(*) FROM JSONB_ARRAY_ELEMENTS(p_labour_drafts))
    <> (SELECT COUNT(DISTINCT value->>'draft_id') FROM JSONB_ARRAY_ELEMENTS(p_labour_drafts))
    OR (SELECT COUNT(*) FROM JSONB_ARRAY_ELEMENTS(p_plant_drafts))
    <> (SELECT COUNT(DISTINCT value->>'draft_id') FROM JSONB_ARRAY_ELEMENTS(p_plant_drafts)) THEN
    RAISE EXCEPTION 'CONVERSION_DUPLICATE_INPUT';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.daily_labour_allocation_drafts drafts
    JOIN public.profiles profiles ON profiles.id = drafts.profile_id
    WHERE drafts.work_date = p_work_date AND profiles.team_id = p_team_id
      AND NOT EXISTS (
        SELECT 1 FROM JSONB_ARRAY_ELEMENTS(p_labour_drafts) supplied
        WHERE (supplied->>'draft_id')::UUID = drafts.id
          AND (supplied->>'row_version')::INTEGER = drafts.row_version
      )
  ) OR EXISTS (
    SELECT 1 FROM JSONB_ARRAY_ELEMENTS(p_labour_drafts) supplied
    LEFT JOIN public.daily_labour_allocation_drafts drafts
      ON drafts.id = (supplied->>'draft_id')::UUID
    LEFT JOIN public.profiles profiles ON profiles.id = drafts.profile_id
    WHERE drafts.id IS NULL OR drafts.work_date <> p_work_date
      OR profiles.team_id IS DISTINCT FROM p_team_id
      OR drafts.row_version <> (supplied->>'row_version')::INTEGER
  ) THEN
    RAISE EXCEPTION 'CONVERSION_LABOUR_SOURCE_MISMATCH';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.daily_plant_allocation_drafts drafts
    WHERE drafts.work_date = p_work_date AND drafts.owner_team_id = p_team_id
      AND NOT EXISTS (
        SELECT 1 FROM JSONB_ARRAY_ELEMENTS(p_plant_drafts) supplied
        WHERE (supplied->>'draft_id')::UUID = drafts.id
          AND (supplied->>'row_version')::INTEGER = drafts.row_version
      )
  ) OR EXISTS (
    SELECT 1 FROM JSONB_ARRAY_ELEMENTS(p_plant_drafts) supplied
    LEFT JOIN public.daily_plant_allocation_drafts drafts
      ON drafts.id = (supplied->>'draft_id')::UUID
    WHERE drafts.id IS NULL OR drafts.work_date <> p_work_date
      OR drafts.owner_team_id IS DISTINCT FROM p_team_id
      OR drafts.row_version <> (supplied->>'row_version')::INTEGER
  ) THEN
    RAISE EXCEPTION 'CONVERSION_PLANT_SOURCE_MISMATCH';
  END IF;

  SELECT COALESCE(ARRAY_AGG(drafts.profile_id ORDER BY drafts.profile_id), ARRAY[]::UUID[])
  INTO profile_ids
  FROM public.daily_labour_allocation_drafts drafts
  JOIN public.profiles profiles ON profiles.id = drafts.profile_id
  WHERE drafts.work_date = p_work_date AND profiles.team_id = p_team_id;
  SELECT COALESCE(
    ARRAY_AGG(drafts.plant_id ORDER BY drafts.plant_id)
      FILTER (WHERE drafts.plant_id IS NOT NULL),
    ARRAY[]::UUID[]
  ) INTO plant_ids
  FROM public.daily_plant_allocation_drafts drafts
  WHERE drafts.work_date = p_work_date AND drafts.owner_team_id = p_team_id;
  SELECT COALESCE(
    ARRAY_AGG(
      drafts.hired_serial_normalized || ':' || drafts.hired_company_normalized
      ORDER BY drafts.hired_serial_normalized, drafts.hired_company_normalized
    ) FILTER (WHERE drafts.plant_kind = 'hired'),
    ARRAY[]::TEXT[]
  ) INTO hired_keys
  FROM public.daily_plant_allocation_drafts drafts
  WHERE drafts.work_date = p_work_date AND drafts.owner_team_id = p_team_id;
  PERFORM private.lock_daily_allocation_resource_keys(profile_ids, plant_ids, hired_keys);
  FOR job_input IN
    SELECT DISTINCT value->>'job_source_type' AS source_type,
      (value->>'job_source_id')::UUID AS source_id
    FROM JSONB_ARRAY_ELEMENTS(p_visits)
    ORDER BY source_type, source_id
  LOOP
    PERFORM private.daily_allocation_v2_lock_job_source(
      job_input.source_type, job_input.source_id
    );
  END LOOP;

  INSERT INTO public.daily_allocation_plan_days (
    work_date, team_id, plan_version, converted_by, created_by, updated_by
  ) VALUES (p_work_date, p_team_id, 1, actor_id, actor_id, actor_id)
  RETURNING * INTO plan_day;

  FOR visit_input IN SELECT value FROM JSONB_ARRAY_ELEMENTS(p_visits)
  LOOP
    IF NOT private.daily_allocation_interval_is_valid(
      p_work_date,
      (visit_input->>'starts_at')::TIMESTAMPTZ,
      (visit_input->>'ends_at')::TIMESTAMPTZ
    ) THEN
      RAISE EXCEPTION 'Invalid visit interval';
    END IF;
    visit_job := private.apply_allocation_job_fields(
      visit_input->>'job_source_type',
      (visit_input->>'job_source_id')::UUID,
      NULL,
      TRUE
    );
    INSERT INTO public.daily_allocation_visits (
      id, plan_day_id, work_date, owner_team_id,
      job_source_type, job_source_id, job_code, site_address,
      starts_at, ends_at, meeting_point, meet_person, notes,
      created_by, updated_by
    ) VALUES (
      (visit_input->>'visit_id')::UUID, plan_day.id, p_work_date, p_team_id,
      visit_job.source_type, visit_job.source_id, visit_job.job_code, visit_job.site_address,
      (visit_input->>'starts_at')::TIMESTAMPTZ,
      (visit_input->>'ends_at')::TIMESTAMPTZ,
      NULLIF(BTRIM(visit_input->>'meeting_point'), ''),
      NULLIF(BTRIM(visit_input->>'meet_person'), ''),
      NULLIF(BTRIM(visit_input->>'notes'), ''),
      actor_id, actor_id
    );
  END LOOP;
  FOR labour_input IN SELECT value FROM JSONB_ARRAY_ELEMENTS(p_labour_drafts)
  LOOP
    SELECT * INTO STRICT labour_row
    FROM public.daily_labour_allocation_drafts
    WHERE id = (labour_input->>'draft_id')::UUID;
    IF labour_input->>'disposition' NOT IN ('visit', 'unallocated', 'absence') THEN
      RAISE EXCEPTION 'CONVERSION_DISPOSITION_REQUIRED';
    END IF;
    IF labour_input->>'disposition' IN ('unallocated', 'absence') THEN
      IF NULLIF(labour_input->>'visit_id', '') IS NOT NULL THEN
        RAISE EXCEPTION 'CONVERSION_FOREIGN_VISIT';
      END IF;
      IF labour_input->>'disposition' = 'absence' AND NOT EXISTS (
        SELECT 1 FROM public.absences absences
        JOIN public.absence_reasons reasons ON reasons.id = absences.reason_id
        WHERE absences.profile_id = labour_row.profile_id
          AND absences.status IN ('approved', 'processed')
          AND reasons.allocation_behaviour IN ('block', 'reduce')
          AND p_work_date BETWEEN absences.date AND COALESCE(absences.end_date, absences.date)
      ) THEN
        RAISE EXCEPTION 'CONVERSION_ABSENCE_NOT_FOUND';
      END IF;
      CONTINUE;
    END IF;
    IF labour_row.job_source_id IS NULL THEN
      IF labour_input->>'disposition' <> 'unallocated'
        OR NULLIF(labour_input->>'visit_id', '') IS NOT NULL THEN
        RAISE EXCEPTION 'CONVERSION_NULL_JOB_DISPOSITION_REQUIRED';
      END IF;
      CONTINUE;
    END IF;
    IF labour_input->>'disposition' <> 'visit'
      OR NULLIF(labour_input->>'visit_id', '') IS NULL THEN
      RAISE EXCEPTION 'CONVERSION_LABOUR_VISIT_REQUIRED';
    END IF;
    SELECT * INTO visit_row FROM public.daily_allocation_visits
    WHERE id = (labour_input->>'visit_id')::UUID AND plan_day_id = plan_day.id;
    IF visit_row.id IS NULL THEN RAISE EXCEPTION 'CONVERSION_FOREIGN_VISIT'; END IF;
    job_row := private.apply_allocation_job_fields(
      labour_row.job_source_type, labour_row.job_source_id, labour_row.job_code, TRUE
    );
    IF (visit_row.job_source_type, visit_row.job_source_id)
      IS DISTINCT FROM (job_row.source_type, job_row.source_id) THEN
      RAISE EXCEPTION 'CONVERSION_JOB_MISMATCH';
    END IF;
    INSERT INTO public.daily_allocation_visit_labour (
      visit_id, plan_day_id, work_date, profile_id, starts_at, ends_at,
      meeting_point, meet_person, notes, created_by, updated_by
    ) VALUES (
      visit_row.id, plan_day.id, p_work_date, labour_row.profile_id,
      visit_row.starts_at, visit_row.ends_at, labour_row.meeting_point,
      labour_row.meet_person, labour_row.notes, actor_id, actor_id
    );
  END LOOP;

  FOR plant_input IN SELECT value FROM JSONB_ARRAY_ELEMENTS(p_plant_drafts)
  LOOP
    SELECT * INTO STRICT plant_row
    FROM public.daily_plant_allocation_drafts
    WHERE id = (plant_input->>'draft_id')::UUID;
    IF plant_input->>'disposition' NOT IN ('visit', 'unallocated') THEN
      RAISE EXCEPTION 'CONVERSION_DISPOSITION_REQUIRED';
    END IF;
    IF plant_input->>'disposition' = 'unallocated' THEN
      IF NULLIF(plant_input->>'visit_id', '') IS NOT NULL THEN
        RAISE EXCEPTION 'CONVERSION_FOREIGN_VISIT';
      END IF;
      CONTINUE;
    END IF;
    IF NULLIF(plant_input->>'visit_id', '') IS NULL THEN
      RAISE EXCEPTION 'CONVERSION_PLANT_VISIT_REQUIRED';
    END IF;
    SELECT * INTO visit_row FROM public.daily_allocation_visits
    WHERE id = (plant_input->>'visit_id')::UUID AND plan_day_id = plan_day.id;
    IF visit_row.id IS NULL THEN RAISE EXCEPTION 'CONVERSION_FOREIGN_VISIT'; END IF;
    job_row := private.apply_allocation_job_fields(
      plant_row.job_source_type, plant_row.job_source_id, plant_row.job_code, TRUE
    );
    IF (visit_row.job_source_type, visit_row.job_source_id)
      IS DISTINCT FROM (job_row.source_type, job_row.source_id) THEN
      RAISE EXCEPTION 'CONVERSION_JOB_MISMATCH';
    END IF;
    INSERT INTO public.daily_allocation_visit_plant (
      visit_id, plan_day_id, work_date, plant_kind, plant_id,
      hired_serial, hired_description, hired_company, owner_team_id,
      starts_at, ends_at, notes, created_by, updated_by
    ) VALUES (
      visit_row.id, plan_day.id, p_work_date, plant_row.plant_kind, plant_row.plant_id,
      plant_row.hired_serial, plant_row.hired_description, plant_row.hired_company,
      plant_row.owner_team_id, visit_row.starts_at, visit_row.ends_at,
      plant_row.notes, actor_id, actor_id
    );
  END LOOP;

  result := JSONB_BUILD_OBJECT(
    'plan_day_id', plan_day.id,
    'plan_version', plan_day.plan_version,
    'team_id', plan_day.team_id,
    'work_date', plan_day.work_date,
    'source_fingerprint', actual_fingerprint,
    'visits', COALESCE((
      SELECT JSONB_AGG(TO_JSONB(visits) ORDER BY visits.starts_at, visits.id)
      FROM public.daily_allocation_visits visits WHERE visits.plan_day_id = plan_day.id
    ), '[]'::JSONB),
    'labour_assignments', COALESCE((
      SELECT JSONB_AGG(TO_JSONB(labour) ORDER BY labour.id)
      FROM public.daily_allocation_visit_labour labour WHERE labour.plan_day_id = plan_day.id
    ), '[]'::JSONB),
    'plant_assignments', COALESCE((
      SELECT JSONB_AGG(TO_JSONB(plant) ORDER BY plant.id)
      FROM public.daily_allocation_visit_plant plant WHERE plant.plan_day_id = plan_day.id
    ), '[]'::JSONB)
  );
  RETURN private.daily_allocation_request_store(
    p_request_id, actor_id, 'convert', payload, result
  );
END;
$$;

-- Idempotent wrappers. Writer/runtime authorization always precedes replay;
-- replay always precedes entity lookup in the existing mutation bodies.
CREATE OR REPLACE FUNCTION public.upsert_daily_allocation_visit_v2(
  p_request_id UUID, p_visit_id UUID, p_plan_day_id UUID,
  p_expected_plan_version INTEGER, p_expected_row_version INTEGER,
  p_job_source_type TEXT, p_job_source_id UUID, p_job_code TEXT,
  p_starts_at TIMESTAMPTZ, p_ends_at TIMESTAMPTZ,
  p_meeting_point TEXT DEFAULT NULL, p_meet_person TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
DECLARE actor_id UUID; payload JSONB; result JSONB;
BEGIN
  actor_id := private.require_daily_allocation_v2_writer();
  IF p_expected_plan_version IS NULL
    OR (p_visit_id IS NOT NULL AND p_expected_row_version IS NULL) THEN
    RAISE EXCEPTION 'STALE_ENTITY_VERSION';
  END IF;
  payload := JSONB_BUILD_OBJECT(
    'visit_id', p_visit_id, 'plan_day_id', p_plan_day_id,
    'expected_plan_version', p_expected_plan_version,
    'expected_row_version', p_expected_row_version,
    'job_source_type', p_job_source_type, 'job_source_id', p_job_source_id,
    'job_code', p_job_code, 'starts_at', p_starts_at, 'ends_at', p_ends_at,
    'meeting_point', p_meeting_point, 'meet_person', p_meet_person, 'notes', p_notes
  );
  result := private.daily_allocation_request_replay(p_request_id, actor_id, 'visit_upsert', payload);
  IF result IS NOT NULL THEN RETURN result; END IF;
  result := public.upsert_daily_allocation_visit_v2(
    p_visit_id, p_plan_day_id, p_expected_plan_version, p_expected_row_version,
    p_job_source_type, p_job_source_id, p_job_code, p_starts_at, p_ends_at,
    p_meeting_point, p_meet_person, p_notes
  );
  RETURN private.daily_allocation_request_store(p_request_id, actor_id, 'visit_upsert', payload, result);
END; $$;

CREATE OR REPLACE FUNCTION public.move_daily_allocation_visit_v2(
  p_request_id UUID, p_visit_id UUID, p_target_plan_day_id UUID,
  p_expected_source_plan_version INTEGER, p_expected_target_plan_version INTEGER,
  p_expected_row_version INTEGER, p_starts_at TIMESTAMPTZ, p_ends_at TIMESTAMPTZ
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
DECLARE actor_id UUID; payload JSONB; result JSONB;
BEGIN
  actor_id := private.require_daily_allocation_v2_writer();
  IF p_expected_source_plan_version IS NULL
    OR p_expected_target_plan_version IS NULL
    OR p_expected_row_version IS NULL THEN
    RAISE EXCEPTION 'STALE_ENTITY_VERSION';
  END IF;
  payload := JSONB_BUILD_OBJECT(
    'visit_id', p_visit_id, 'target_plan_day_id', p_target_plan_day_id,
    'expected_source_plan_version', p_expected_source_plan_version,
    'expected_target_plan_version', p_expected_target_plan_version,
    'expected_row_version', p_expected_row_version,
    'starts_at', p_starts_at, 'ends_at', p_ends_at
  );
  result := private.daily_allocation_request_replay(p_request_id, actor_id, 'visit_move', payload);
  IF result IS NOT NULL THEN RETURN result; END IF;
  result := public.move_daily_allocation_visit_v2(
    p_visit_id, p_target_plan_day_id, p_expected_source_plan_version,
    p_expected_target_plan_version, p_expected_row_version, p_starts_at, p_ends_at
  );
  RETURN private.daily_allocation_request_store(p_request_id, actor_id, 'visit_move', payload, result);
END; $$;

CREATE OR REPLACE FUNCTION public.delete_daily_allocation_visit_v2(
  p_request_id UUID, p_visit_id UUID, p_expected_plan_version INTEGER,
  p_expected_row_version INTEGER
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
DECLARE
  actor_id UUID; payload JSONB; result JSONB; deleted_id UUID;
  visit public.daily_allocation_visits%ROWTYPE;
  plan_id UUID;
  next_plan_version INTEGER;
BEGIN
  actor_id := private.require_daily_allocation_v2_writer();
  IF p_expected_plan_version IS NULL OR p_expected_row_version IS NULL THEN
    RAISE EXCEPTION 'STALE_ENTITY_VERSION';
  END IF;
  payload := JSONB_BUILD_OBJECT(
    'visit_id', p_visit_id, 'expected_plan_version', p_expected_plan_version,
    'expected_row_version', p_expected_row_version
  );
  result := private.daily_allocation_request_replay(p_request_id, actor_id, 'visit_delete', payload);
  IF result IS NOT NULL THEN RETURN result; END IF;
  SELECT * INTO visit FROM public.daily_allocation_visits WHERE id = p_visit_id;
  plan_id := visit.plan_day_id;
  deleted_id := public.delete_daily_allocation_visit_v2(
    p_visit_id, p_expected_plan_version, p_expected_row_version
  );
  SELECT plan_version INTO next_plan_version
  FROM public.daily_allocation_plan_days WHERE id = plan_id;
  result := JSONB_BUILD_OBJECT(
    'visit_id', deleted_id, 'plan_day_id', plan_id,
    'plan_version', next_plan_version
  );
  RETURN private.daily_allocation_request_store(p_request_id, actor_id, 'visit_delete', payload, result);
END; $$;

CREATE OR REPLACE FUNCTION public.assign_daily_allocation_labour_v2(
  p_request_id UUID, p_visit_id UUID, p_profile_id UUID,
  p_expected_plan_version INTEGER, p_expected_row_version INTEGER DEFAULT NULL,
  p_meeting_point TEXT DEFAULT NULL, p_meet_person TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL, p_override_id UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
DECLARE
  actor_id UUID; payload JSONB; result JSONB; assignment_id UUID;
  existing public.daily_allocation_visit_labour%ROWTYPE;
  assignment public.daily_allocation_visit_labour%ROWTYPE;
  visit public.daily_allocation_visits%ROWTYPE;
  plan public.daily_allocation_plan_days%ROWTYPE;
  plan_version INTEGER;
BEGIN
  actor_id := private.require_daily_allocation_v2_writer();
  IF p_expected_plan_version IS NULL THEN
    RAISE EXCEPTION 'STALE_PLAN_VERSION';
  END IF;
  payload := JSONB_BUILD_OBJECT(
    'visit_id', p_visit_id, 'profile_id', p_profile_id,
    'expected_plan_version', p_expected_plan_version,
    'expected_row_version', p_expected_row_version,
    'meeting_point', p_meeting_point, 'meet_person', p_meet_person,
    'notes', p_notes, 'override_id', p_override_id
  );
  result := private.daily_allocation_request_replay(p_request_id, actor_id, 'labour_assign', payload);
  IF result IS NOT NULL THEN RETURN result; END IF;
  SELECT * INTO visit FROM public.daily_allocation_visits WHERE id = p_visit_id;
  IF visit.id IS NULL THEN RAISE EXCEPTION 'Visit not found'; END IF;
  SELECT * INTO plan FROM public.daily_allocation_plan_days WHERE id = visit.plan_day_id;
  PERFORM private.lock_daily_allocation_plan_day(plan.work_date, plan.team_id);
  SELECT * INTO visit FROM public.daily_allocation_visits WHERE id = p_visit_id;
  IF visit.id IS NULL OR visit.plan_day_id <> plan.id THEN
    RAISE EXCEPTION 'STALE_PLAN_VERSION';
  END IF;
  SELECT * INTO existing FROM public.daily_allocation_visit_labour
  WHERE visit_id = p_visit_id AND profile_id = p_profile_id;
  IF existing.id IS NOT NULL AND (
    p_expected_row_version IS NULL OR existing.row_version <> p_expected_row_version
  ) THEN RAISE EXCEPTION 'STALE_ENTITY_VERSION'; END IF;
  IF existing.id IS NULL AND p_expected_row_version IS NOT NULL THEN
    RAISE EXCEPTION 'STALE_ENTITY_VERSION';
  END IF;
  assignment_id := public.assign_daily_allocation_labour_v2(
    p_visit_id, p_profile_id, p_expected_plan_version, p_meeting_point,
    p_meet_person, p_notes, p_override_id
  );
  SELECT * INTO assignment FROM public.daily_allocation_visit_labour WHERE id = assignment_id;
  SELECT plan_days.plan_version INTO plan_version
  FROM public.daily_allocation_plan_days plan_days WHERE plan_days.id = assignment.plan_day_id;
  result := JSONB_BUILD_OBJECT(
    'assignment_id', assignment.id, 'assignment', TO_JSONB(assignment),
    'plan_day_id', assignment.plan_day_id, 'plan_version', plan_version
  );
  RETURN private.daily_allocation_request_store(p_request_id, actor_id, 'labour_assign', payload, result);
END; $$;

CREATE OR REPLACE FUNCTION public.unassign_daily_allocation_labour_v2(
  p_request_id UUID, p_assignment_id UUID, p_expected_plan_version INTEGER,
  p_expected_row_version INTEGER
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
DECLARE
  actor_id UUID; payload JSONB; result JSONB;
  existing public.daily_allocation_visit_labour%ROWTYPE;
  plan public.daily_allocation_plan_days%ROWTYPE;
  next_plan_version INTEGER;
BEGIN
  actor_id := private.require_daily_allocation_v2_writer();
  IF p_expected_plan_version IS NULL OR p_expected_row_version IS NULL THEN
    RAISE EXCEPTION 'STALE_ENTITY_VERSION';
  END IF;
  payload := JSONB_BUILD_OBJECT(
    'assignment_id', p_assignment_id, 'expected_plan_version', p_expected_plan_version,
    'expected_row_version', p_expected_row_version
  );
  result := private.daily_allocation_request_replay(p_request_id, actor_id, 'labour_unassign', payload);
  IF result IS NOT NULL THEN RETURN result; END IF;
  SELECT * INTO existing FROM public.daily_allocation_visit_labour WHERE id = p_assignment_id;
  IF existing.id IS NULL THEN RAISE EXCEPTION 'Labour assignment not found'; END IF;
  SELECT * INTO plan FROM public.daily_allocation_plan_days WHERE id = existing.plan_day_id;
  PERFORM private.lock_daily_allocation_plan_day(plan.work_date, plan.team_id);
  SELECT * INTO existing FROM public.daily_allocation_visit_labour WHERE id = p_assignment_id;
  IF existing.id IS NULL THEN RAISE EXCEPTION 'Labour assignment not found'; END IF;
  IF existing.plan_day_id <> plan.id THEN RAISE EXCEPTION 'STALE_PLAN_VERSION'; END IF;
  IF p_expected_row_version IS NULL
    OR existing.row_version <> p_expected_row_version THEN
    RAISE EXCEPTION 'STALE_ENTITY_VERSION';
  END IF;
  PERFORM public.unassign_daily_allocation_labour_v2(p_assignment_id, p_expected_plan_version);
  SELECT plan_version INTO next_plan_version
  FROM public.daily_allocation_plan_days WHERE id = plan.id;
  result := JSONB_BUILD_OBJECT(
    'assignment_id', p_assignment_id, 'plan_day_id', plan.id,
    'plan_version', next_plan_version
  );
  RETURN private.daily_allocation_request_store(p_request_id, actor_id, 'labour_unassign', payload, result);
END; $$;

DROP FUNCTION IF EXISTS public.assign_daily_allocation_plant_v2(UUID, UUID, INTEGER, TEXT, UUID, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.assign_daily_allocation_plant_v2(
  p_request_id UUID, p_visit_id UUID, p_expected_plan_version INTEGER,
  p_expected_row_version INTEGER DEFAULT NULL,
  p_plant_kind TEXT DEFAULT NULL, p_plant_id UUID DEFAULT NULL,
  p_hired_serial TEXT DEFAULT NULL, p_hired_description TEXT DEFAULT NULL,
  p_hired_company TEXT DEFAULT NULL, p_notes TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
DECLARE
  actor_id UUID; payload JSONB; result JSONB; assignment_id UUID;
  existing public.daily_allocation_visit_plant%ROWTYPE;
  assignment public.daily_allocation_visit_plant%ROWTYPE;
  visit public.daily_allocation_visits%ROWTYPE;
  plan public.daily_allocation_plan_days%ROWTYPE;
  plan_version INTEGER;
  hired_serial_key TEXT;
  hired_company_key TEXT;
BEGIN
  actor_id := private.require_daily_allocation_v2_writer();
  IF p_expected_plan_version IS NULL THEN
    RAISE EXCEPTION 'STALE_PLAN_VERSION';
  END IF;
  payload := JSONB_BUILD_OBJECT(
    'visit_id', p_visit_id, 'expected_plan_version', p_expected_plan_version,
    'expected_row_version', p_expected_row_version,
    'plant_kind', p_plant_kind, 'plant_id', p_plant_id,
    'hired_serial', p_hired_serial, 'hired_description', p_hired_description,
    'hired_company', p_hired_company, 'notes', p_notes
  );
  result := private.daily_allocation_request_replay(p_request_id, actor_id, 'plant_assign', payload);
  IF result IS NOT NULL THEN RETURN result; END IF;
  SELECT * INTO visit FROM public.daily_allocation_visits WHERE id = p_visit_id;
  IF visit.id IS NULL THEN RAISE EXCEPTION 'Visit not found'; END IF;
  SELECT * INTO plan FROM public.daily_allocation_plan_days WHERE id = visit.plan_day_id;
  PERFORM private.lock_daily_allocation_plan_day(plan.work_date, plan.team_id);
  SELECT * INTO visit FROM public.daily_allocation_visits WHERE id = p_visit_id;
  IF visit.id IS NULL OR visit.plan_day_id <> plan.id THEN
    RAISE EXCEPTION 'STALE_PLAN_VERSION';
  END IF;
  hired_serial_key := NULLIF(UPPER(BTRIM(regexp_replace(COALESCE(p_hired_serial, ''), '\s+', ' ', 'g'))), '');
  hired_company_key := NULLIF(UPPER(BTRIM(regexp_replace(COALESCE(p_hired_company, ''), '\s+', ' ', 'g'))), '');
  IF p_plant_kind = 'registered' THEN
    SELECT * INTO existing FROM public.daily_allocation_visit_plant
    WHERE visit_id = p_visit_id AND plant_id = p_plant_id;
  ELSE
    SELECT * INTO existing FROM public.daily_allocation_visit_plant
    WHERE visit_id = p_visit_id
      AND plant_kind = 'hired'
      AND hired_serial_normalized = hired_serial_key
      AND hired_company_normalized = hired_company_key;
  END IF;
  IF existing.id IS NOT NULL AND (
    p_expected_row_version IS NULL OR existing.row_version <> p_expected_row_version
  ) THEN RAISE EXCEPTION 'STALE_ENTITY_VERSION'; END IF;
  IF existing.id IS NULL AND p_expected_row_version IS NOT NULL THEN
    RAISE EXCEPTION 'STALE_ENTITY_VERSION';
  END IF;
  IF existing.id IS NOT NULL THEN
    PERFORM private.lock_daily_allocation_resource_keys(
      ARRAY[]::UUID[],
      CASE WHEN existing.plant_id IS NULL THEN ARRAY[]::UUID[] ELSE ARRAY[existing.plant_id] END,
      CASE
        WHEN existing.plant_kind = 'hired'
          THEN ARRAY[existing.hired_serial_normalized || ':' || existing.hired_company_normalized]
        ELSE ARRAY[]::TEXT[]
      END
    );
    PERFORM private.bump_daily_allocation_plan_version(
      plan.id, p_expected_plan_version, actor_id
    );
    UPDATE public.daily_allocation_visit_plant
    SET
      notes = p_notes,
      row_version = daily_allocation_visit_plant.row_version + 1,
      updated_by = actor_id
    WHERE id = existing.id
      AND row_version = p_expected_row_version
    RETURNING * INTO assignment;
    IF assignment.id IS NULL THEN
      RAISE EXCEPTION 'STALE_ENTITY_VERSION';
    END IF;
    assignment_id := assignment.id;
  ELSE
    assignment_id := public.assign_daily_allocation_plant_v2(
      p_visit_id, p_expected_plan_version, p_plant_kind, p_plant_id,
      p_hired_serial, p_hired_description, p_hired_company, p_notes
    );
    SELECT * INTO assignment FROM public.daily_allocation_visit_plant WHERE id = assignment_id;
  END IF;
  SELECT plan_days.plan_version INTO plan_version
  FROM public.daily_allocation_plan_days plan_days WHERE plan_days.id = assignment.plan_day_id;
  result := JSONB_BUILD_OBJECT(
    'assignment_id', assignment.id, 'assignment', TO_JSONB(assignment),
    'plan_day_id', assignment.plan_day_id, 'plan_version', plan_version
  );
  RETURN private.daily_allocation_request_store(p_request_id, actor_id, 'plant_assign', payload, result);
END; $$;

CREATE OR REPLACE FUNCTION public.unassign_daily_allocation_plant_v2(
  p_request_id UUID, p_assignment_id UUID, p_expected_plan_version INTEGER,
  p_expected_row_version INTEGER
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
DECLARE
  actor_id UUID; payload JSONB; result JSONB;
  existing public.daily_allocation_visit_plant%ROWTYPE;
  plan public.daily_allocation_plan_days%ROWTYPE;
  next_plan_version INTEGER;
BEGIN
  actor_id := private.require_daily_allocation_v2_writer();
  IF p_expected_plan_version IS NULL OR p_expected_row_version IS NULL THEN
    RAISE EXCEPTION 'STALE_ENTITY_VERSION';
  END IF;
  payload := JSONB_BUILD_OBJECT(
    'assignment_id', p_assignment_id, 'expected_plan_version', p_expected_plan_version,
    'expected_row_version', p_expected_row_version
  );
  result := private.daily_allocation_request_replay(p_request_id, actor_id, 'plant_unassign', payload);
  IF result IS NOT NULL THEN RETURN result; END IF;
  SELECT * INTO existing FROM public.daily_allocation_visit_plant WHERE id = p_assignment_id;
  IF existing.id IS NULL THEN RAISE EXCEPTION 'Plant assignment not found'; END IF;
  SELECT * INTO plan FROM public.daily_allocation_plan_days WHERE id = existing.plan_day_id;
  PERFORM private.lock_daily_allocation_plan_day(plan.work_date, plan.team_id);
  SELECT * INTO existing FROM public.daily_allocation_visit_plant WHERE id = p_assignment_id;
  IF existing.id IS NULL THEN RAISE EXCEPTION 'Plant assignment not found'; END IF;
  IF existing.plan_day_id <> plan.id THEN RAISE EXCEPTION 'STALE_PLAN_VERSION'; END IF;
  IF p_expected_row_version IS NULL
    OR existing.row_version <> p_expected_row_version THEN
    RAISE EXCEPTION 'STALE_ENTITY_VERSION';
  END IF;
  PERFORM public.unassign_daily_allocation_plant_v2(p_assignment_id, p_expected_plan_version);
  SELECT plan_version INTO next_plan_version
  FROM public.daily_allocation_plan_days WHERE id = plan.id;
  result := JSONB_BUILD_OBJECT(
    'assignment_id', p_assignment_id, 'plan_day_id', plan.id,
    'plan_version', next_plan_version
  );
  RETURN private.daily_allocation_request_store(p_request_id, actor_id, 'plant_unassign', payload, result);
END; $$;

CREATE OR REPLACE FUNCTION public.create_daily_allocation_conflict_override_v2(
  p_request_id UUID, p_plan_day_id UUID, p_expected_plan_version INTEGER,
  p_conflict_kind TEXT, p_evidence TEXT, p_visit_id UUID DEFAULT NULL,
  p_profile_id UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
DECLARE actor_id UUID; payload JSONB; result JSONB; override_id UUID; override_row public.daily_allocation_conflict_overrides%ROWTYPE; plan_version INTEGER;
BEGIN
  actor_id := private.require_daily_allocation_v2_writer();
  IF p_expected_plan_version IS NULL THEN
    RAISE EXCEPTION 'STALE_PLAN_VERSION';
  END IF;
  payload := JSONB_BUILD_OBJECT(
    'plan_day_id', p_plan_day_id, 'expected_plan_version', p_expected_plan_version,
    'conflict_kind', p_conflict_kind, 'evidence', p_evidence,
    'visit_id', p_visit_id, 'profile_id', p_profile_id
  );
  result := private.daily_allocation_request_replay(p_request_id, actor_id, 'override_create', payload);
  IF result IS NOT NULL THEN RETURN result; END IF;
  override_id := public.create_daily_allocation_conflict_override_v2(
    p_plan_day_id, p_expected_plan_version, p_conflict_kind, p_evidence,
    p_visit_id, p_profile_id
  );
  SELECT * INTO override_row FROM public.daily_allocation_conflict_overrides WHERE id = override_id;
  SELECT plan_days.plan_version INTO plan_version FROM public.daily_allocation_plan_days plan_days WHERE id = p_plan_day_id;
  result := JSONB_BUILD_OBJECT(
    'override_id', override_id, 'override', TO_JSONB(override_row),
    'plan_day_id', p_plan_day_id, 'plan_version', plan_version
  );
  RETURN private.daily_allocation_request_store(p_request_id, actor_id, 'override_create', payload, result);
END; $$;

CREATE OR REPLACE FUNCTION public.publish_daily_allocation_plan_v2(
  p_request_id UUID, p_plan_day_id UUID, p_expected_plan_version INTEGER,
  p_idempotency_key TEXT, p_confirm_unallocated BOOLEAN
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
DECLARE actor_id UUID; payload JSONB; result JSONB; publication_id UUID;
BEGIN
  actor_id := private.require_daily_allocation_v2_writer();
  IF p_expected_plan_version IS NULL THEN
    RAISE EXCEPTION 'STALE_PLAN_VERSION';
  END IF;
  payload := JSONB_BUILD_OBJECT(
    'plan_day_id', p_plan_day_id, 'expected_plan_version', p_expected_plan_version,
    'idempotency_key', p_idempotency_key, 'confirm_unallocated', p_confirm_unallocated
  );
  result := private.daily_allocation_request_replay(p_request_id, actor_id, 'publish', payload);
  IF result IS NOT NULL THEN RETURN result; END IF;
  publication_id := public.publish_daily_allocation_plan_v2(
    p_plan_day_id, p_expected_plan_version, p_idempotency_key, p_confirm_unallocated
  );
  result := JSONB_BUILD_OBJECT('publication_id', publication_id, 'snapshot_version', 2);
  RETURN private.daily_allocation_request_store(p_request_id, actor_id, 'publish', payload, result);
END; $$;

-- Obsolete unaudited overloads are retained only as private implementation
-- details callable by the definer-owned wrappers.
REVOKE ALL ON FUNCTION public.convert_daily_allocation_plan_day_v2(DATE, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.upsert_daily_allocation_visit_v2(UUID, UUID, INTEGER, INTEGER, TEXT, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.move_daily_allocation_visit_v2(UUID, UUID, INTEGER, INTEGER, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.delete_daily_allocation_visit_v2(UUID, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.assign_daily_allocation_labour_v2(UUID, UUID, INTEGER, TEXT, TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.unassign_daily_allocation_labour_v2(UUID, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.assign_daily_allocation_plant_v2(UUID, INTEGER, TEXT, UUID, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.unassign_daily_allocation_plant_v2(UUID, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_daily_allocation_conflict_override_v2(UUID, INTEGER, TEXT, TEXT, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.publish_daily_allocation_plan_v2(UUID, INTEGER, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated, service_role;

-- Private helpers are reachable only by definer-owned entry points/triggers.
-- The private schema boundary is primary; explicit function ACLs are defence
-- in depth if a future schema grant is accidentally broadened.
REVOKE ALL ON FUNCTION private.guard_daily_allocation_request_immutable()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.daily_allocation_semantic_hash(JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.daily_allocation_request_replay(UUID, UUID, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.daily_allocation_request_store(UUID, UUID, TEXT, JSONB, JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.daily_allocation_conversion_source_payload(DATE, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.daily_allocation_conversion_source_fingerprint(DATE, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_daily_labour_allocation_draft_write()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_daily_plant_allocation_draft_write()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.prepare_daily_allocation_publication()
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_daily_allocation_conversion_source_v2(DATE, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_daily_allocation_conversion_source_v2(DATE, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.convert_daily_allocation_plan_day_v2(UUID, DATE, TEXT, TEXT, JSONB, JSONB, JSONB) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.convert_daily_allocation_plan_day_v2(UUID, DATE, TEXT, TEXT, JSONB, JSONB, JSONB) TO authenticated;
REVOKE ALL ON FUNCTION public.upsert_daily_allocation_visit_v2(UUID, UUID, UUID, INTEGER, INTEGER, TEXT, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_daily_allocation_visit_v2(UUID, UUID, UUID, INTEGER, INTEGER, TEXT, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.move_daily_allocation_visit_v2(UUID, UUID, UUID, INTEGER, INTEGER, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.move_daily_allocation_visit_v2(UUID, UUID, UUID, INTEGER, INTEGER, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
REVOKE ALL ON FUNCTION public.delete_daily_allocation_visit_v2(UUID, UUID, INTEGER, INTEGER) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_daily_allocation_visit_v2(UUID, UUID, INTEGER, INTEGER) TO authenticated;
REVOKE ALL ON FUNCTION public.assign_daily_allocation_labour_v2(UUID, UUID, UUID, INTEGER, INTEGER, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.assign_daily_allocation_labour_v2(UUID, UUID, UUID, INTEGER, INTEGER, TEXT, TEXT, TEXT, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.unassign_daily_allocation_labour_v2(UUID, UUID, INTEGER, INTEGER) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.unassign_daily_allocation_labour_v2(UUID, UUID, INTEGER, INTEGER) TO authenticated;
REVOKE ALL ON FUNCTION public.assign_daily_allocation_plant_v2(UUID, UUID, INTEGER, INTEGER, TEXT, UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.assign_daily_allocation_plant_v2(UUID, UUID, INTEGER, INTEGER, TEXT, UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.unassign_daily_allocation_plant_v2(UUID, UUID, INTEGER, INTEGER) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.unassign_daily_allocation_plant_v2(UUID, UUID, INTEGER, INTEGER) TO authenticated;
REVOKE ALL ON FUNCTION public.create_daily_allocation_conflict_override_v2(UUID, UUID, INTEGER, TEXT, TEXT, UUID, UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_daily_allocation_conflict_override_v2(UUID, UUID, INTEGER, TEXT, TEXT, UUID, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.publish_daily_allocation_plan_v2(UUID, UUID, INTEGER, TEXT, BOOLEAN) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.publish_daily_allocation_plan_v2(UUID, UUID, INTEGER, TEXT, BOOLEAN) TO authenticated;

-- Explicitly preserve the closed predeploy state.
UPDATE private.daily_allocation_v2_runtime
SET board_enabled = FALSE, writes_enabled = FALSE
WHERE singleton = TRUE
  AND (board_enabled IS DISTINCT FROM FALSE OR writes_enabled IS DISTINCT FROM FALSE);

COMMIT;
