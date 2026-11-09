-- finalise-phase: predeploy
-- Drafts may lack an address; publishing still uses the strict canonical resolver.
BEGIN;

ALTER TABLE public.daily_allocation_visits
  DROP CONSTRAINT daily_allocation_visits_job_identity_check,
  ADD CONSTRAINT daily_allocation_visits_job_identity_check
    CHECK (NULLIF(BTRIM(job_code), '') IS NOT NULL);

CREATE OR REPLACE FUNCTION private.apply_daily_allocation_draft_job(
  p_source_type TEXT, p_source_id UUID, p_job_code TEXT
)
RETURNS private.allocation_job
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE job_row private.allocation_job;
BEGIN
  job_row := private.apply_allocation_job_fields(p_source_type, p_source_id, p_job_code, FALSE);
  IF job_row.source_id IS NULL THEN
    RAISE EXCEPTION 'JOB_NOT_FOUND';
  END IF;
  job_row.site_address := COALESCE(job_row.site_address, '');
  RETURN job_row;
END;
$$;
REVOKE ALL ON FUNCTION private.apply_daily_allocation_draft_job(TEXT, UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.refresh_daily_allocation_draft_job()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE job_row private.allocation_job;
BEGIN
  job_row := private.apply_daily_allocation_draft_job(NEW.job_source_type, NEW.job_source_id, NEW.job_code);
  NEW.job_source_type := job_row.source_type;
  NEW.job_source_id := job_row.source_id;
  NEW.job_code := job_row.job_code;
  NEW.site_address := job_row.site_address;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.refresh_daily_allocation_draft_job()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER daily_allocation_visits_canonical_job_guard
  BEFORE INSERT OR UPDATE OF job_source_type, job_source_id, job_code, site_address, plan_day_id, starts_at, ends_at
  ON public.daily_allocation_visits FOR EACH ROW
  EXECUTE FUNCTION private.refresh_daily_allocation_draft_job();


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
  job_row := private.apply_daily_allocation_draft_job(
    p_job_source_type,
    p_job_source_id,
    p_job_code
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

CREATE OR REPLACE FUNCTION public.create_daily_allocation_assigned_visit_v2(
  p_request_id UUID,
  p_plan_day_id UUID,
  p_expected_plan_version INTEGER,
  p_profile_id UUID,
  p_job_source_type TEXT,
  p_job_source_id UUID,
  p_job_code TEXT,
  p_starts_at TIMESTAMPTZ,
  p_ends_at TIMESTAMPTZ,
  p_meeting_point TEXT DEFAULT NULL,
  p_meet_person TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_conflict_kind TEXT DEFAULT NULL,
  p_evidence TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  actor_id UUID;
  payload JSONB;
  replay JSONB;
  plan_day public.daily_allocation_plan_days%ROWTYPE;
  job_row private.allocation_job;
  next_version INTEGER;
  visit_row public.daily_allocation_visits%ROWTYPE;
  assignment_row public.daily_allocation_visit_labour%ROWTYPE;
  override_row public.daily_allocation_conflict_overrides%ROWTYPE;
  conflict_signature TEXT;
  result JSONB;
BEGIN
  actor_id := private.require_daily_allocation_v2_writer();
  IF p_expected_plan_version IS NULL THEN
    RAISE EXCEPTION 'STALE_PLAN_VERSION';
  END IF;
  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'Override subject is required';
  END IF;
  IF p_conflict_kind IS NULL THEN
    IF NULLIF(BTRIM(COALESCE(p_evidence, '')), '') IS NOT NULL THEN
      RAISE EXCEPTION 'Override kind is required';
    END IF;
  ELSIF p_conflict_kind NOT IN ('pending_absence', 'off_shift') THEN
    RAISE EXCEPTION 'HARD_CONFLICT';
  ELSIF NULLIF(BTRIM(COALESCE(p_evidence, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Override evidence is required';
  END IF;

  payload := JSONB_BUILD_OBJECT(
    'plan_day_id', p_plan_day_id,
    'expected_plan_version', p_expected_plan_version,
    'profile_id', p_profile_id,
    'job_source_type', p_job_source_type,
    'job_source_id', p_job_source_id,
    'job_code', p_job_code,
    'starts_at', p_starts_at,
    'ends_at', p_ends_at,
    'meeting_point', p_meeting_point,
    'meet_person', p_meet_person,
    'notes', p_notes,
    'conflict_kind', p_conflict_kind,
    'evidence', p_evidence
  );
  replay := private.daily_allocation_request_replay(
    p_request_id, actor_id, 'assigned_visit_create', payload
  );
  IF replay IS NOT NULL THEN
    RETURN replay;
  END IF;

  IF NOT public.can_actor_manage_daily_allocation(p_profile_id) THEN
    RAISE EXCEPTION 'Not allowed to change this labour allocation';
  END IF;

  SELECT * INTO plan_day
  FROM public.daily_allocation_plan_days
  WHERE id = p_plan_day_id;
  IF plan_day.id IS NULL THEN
    RAISE EXCEPTION 'Plan day not found';
  END IF;
  IF NOT public.can_actor_manage_daily_allocation_team(plan_day.team_id) THEN
    RAISE EXCEPTION 'Not allowed to change this daily allocation plan';
  END IF;
  IF NOT private.daily_allocation_interval_is_valid(plan_day.work_date, p_starts_at, p_ends_at)
    OR NOT private.daily_allocation_is_session_interval(p_starts_at, p_ends_at) THEN
    RAISE EXCEPTION 'Invalid visit interval';
  END IF;

  PERFORM private.lock_daily_allocation_plan_day(plan_day.work_date, plan_day.team_id);
  PERFORM private.lock_daily_allocation_resource_keys(
    ARRAY[p_profile_id],
    ARRAY[]::UUID[],
    ARRAY[]::TEXT[]
  );
  PERFORM private.daily_allocation_v2_lock_job_source(p_job_source_type, p_job_source_id);

  SELECT * INTO plan_day
  FROM public.daily_allocation_plan_days
  WHERE id = p_plan_day_id;
  IF plan_day.id IS NULL THEN
    RAISE EXCEPTION 'STALE_PLAN_VERSION';
  END IF;
  IF NOT public.can_actor_manage_daily_allocation_team(plan_day.team_id) THEN
    RAISE EXCEPTION 'Not allowed to change this daily allocation plan';
  END IF;

  job_row := private.apply_daily_allocation_draft_job(
    p_job_source_type,
    p_job_source_id,
    p_job_code
  );
  next_version := private.bump_daily_allocation_plan_version(
    plan_day.id,
    p_expected_plan_version,
    actor_id
  );

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
    plan_day.id,
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
  ) RETURNING * INTO visit_row;

  IF p_conflict_kind IS NOT NULL THEN
    conflict_signature := private.daily_allocation_v2_conflict_signature(
      p_conflict_kind,
      p_profile_id,
      visit_row.id,
      visit_row.work_date,
      visit_row.starts_at,
      visit_row.ends_at
    );
    IF conflict_signature IS NULL THEN
      RAISE EXCEPTION 'CONFLICT_NOT_PRESENT';
    END IF;
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
      plan_day.id,
      visit_row.id,
      p_profile_id,
      p_conflict_kind,
      conflict_signature,
      BTRIM(p_evidence),
      actor_id,
      pg_catalog.now()
    ) RETURNING * INTO override_row;
  END IF;

  PERFORM private.daily_allocation_v2_assert_labour_assignable(
    plan_day.id,
    visit_row.id,
    p_profile_id,
    visit_row.work_date,
    visit_row.starts_at,
    visit_row.ends_at,
    override_row.id
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
    visit_row.id,
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
  ) RETURNING * INTO assignment_row;

  result := JSONB_BUILD_OBJECT(
    'visit_id', visit_row.id,
    'visit', JSONB_BUILD_OBJECT(
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
    ),
    'assignment_id', assignment_row.id,
    'assignment', JSONB_BUILD_OBJECT(
      'id', assignment_row.id,
      'visit_id', assignment_row.visit_id,
      'plan_day_id', assignment_row.plan_day_id,
      'work_date', assignment_row.work_date,
      'profile_id', assignment_row.profile_id,
      'starts_at', assignment_row.starts_at,
      'ends_at', assignment_row.ends_at,
      'meeting_point', assignment_row.meeting_point,
      'meet_person', assignment_row.meet_person,
      'notes', assignment_row.notes,
      'row_version', assignment_row.row_version,
      'updated_at', assignment_row.updated_at
    ),
    'override_id', override_row.id,
    'override', CASE
      WHEN override_row.id IS NULL THEN NULL
      ELSE JSONB_BUILD_OBJECT(
        'id', override_row.id,
        'plan_day_id', override_row.plan_day_id,
        'visit_id', override_row.visit_id,
        'profile_id', override_row.profile_id,
        'plant_id', override_row.plant_id,
        'conflict_kind', override_row.conflict_kind,
        'evidence', override_row.evidence,
        'confirmed_by', override_row.confirmed_by,
        'confirmed_at', override_row.confirmed_at
      )
    END,
    'plan_day_id', plan_day.id,
    'plan_version', next_version
  );
  RETURN private.daily_allocation_request_store(
    p_request_id, actor_id, 'assigned_visit_create', payload, result
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.copy_daily_allocation_plan_v2(
  p_request_id UUID,
  p_source_date DATE,
  p_target_date DATE,
  p_team_id TEXT,
  p_categories TEXT[],
  p_apply BOOLEAN,
  p_expected_source_plan_version INTEGER,
  p_expected_target_plan_version INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  actor_id UUID;
  payload JSONB;
  replay JSONB;
  source_plan public.daily_allocation_plan_days%ROWTYPE;
  target_plan public.daily_allocation_plan_days%ROWTYPE;
  result JSONB;
  copy_row RECORD;
  job_row private.allocation_job;
BEGIN
  actor_id := private.require_daily_allocation_v2_writer();
  IF NOT public.can_actor_manage_daily_allocation_team(p_team_id) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF p_request_id IS NULL OR p_source_date IS NULL OR p_target_date IS NULL
    OR NULLIF(BTRIM(p_team_id), '') IS NULL OR p_apply IS NULL
    OR p_expected_source_plan_version IS NULL THEN
    RAISE EXCEPTION 'VALIDATION';
  END IF;
  IF p_target_date <> p_source_date + 1 THEN
    RAISE EXCEPTION 'VALIDATION';
  END IF;
  IF p_categories IS NULL OR cardinality(p_categories) = 0 OR EXISTS (
    SELECT 1 FROM unnest(p_categories) AS category
    WHERE category NOT IN ('employees', 'jobs', 'plant')
  ) THEN
    RAISE EXCEPTION 'VALIDATION';
  END IF;

  payload := jsonb_build_object(
    'source_date', p_source_date,
    'target_date', p_target_date,
    'team_id', p_team_id,
    'categories', (SELECT jsonb_agg(category ORDER BY category) FROM unnest(p_categories) AS category),
    'apply', p_apply,
    'expected_source_plan_version', p_expected_source_plan_version,
    'expected_target_plan_version', p_expected_target_plan_version
  );
  replay := private.daily_allocation_request_replay(p_request_id, actor_id, 'plan_copy', payload);
  IF replay IS NOT NULL THEN
    RETURN replay;
  END IF;

  PERFORM private.lock_daily_allocation_plan_day(p_source_date, p_team_id);
  PERFORM private.lock_daily_allocation_plan_day(p_target_date, p_team_id);

  SELECT * INTO source_plan
  FROM public.daily_allocation_plan_days
  WHERE work_date = p_source_date AND team_id = p_team_id
  FOR UPDATE;
  IF NOT FOUND OR source_plan.plan_version <> p_expected_source_plan_version THEN
    RAISE EXCEPTION 'STALE_PLAN_VERSION';
  END IF;

  SELECT * INTO target_plan
  FROM public.daily_allocation_plan_days
  WHERE work_date = p_target_date AND team_id = p_team_id
  FOR UPDATE;
  IF FOUND AND p_apply AND p_expected_target_plan_version IS NULL THEN
    RAISE EXCEPTION 'STALE_PLAN_VERSION';
  END IF;
  IF FOUND AND p_expected_target_plan_version IS NOT NULL
    AND target_plan.plan_version IS DISTINCT FROM p_expected_target_plan_version THEN
    RAISE EXCEPTION 'STALE_PLAN_VERSION';
  END IF;
  IF NOT FOUND AND p_expected_target_plan_version IS NOT NULL THEN
    RAISE EXCEPTION 'STALE_PLAN_VERSION';
  END IF;

  DROP TABLE IF EXISTS pg_temp.daily_allocation_copy_rows;
  CREATE TEMP TABLE daily_allocation_copy_rows ON COMMIT DROP AS
  WITH shifted AS (
    SELECT
      visits.id AS source_visit_id,
      gen_random_uuid() AS new_visit_id,
      visits.job_source_type,
      visits.job_source_id,
      visits.job_code,
      visits.site_address,
      ((visits.starts_at AT TIME ZONE 'Europe/London') + INTERVAL '1 day') AT TIME ZONE 'Europe/London' AS starts_at,
      ((visits.ends_at AT TIME ZONE 'Europe/London') + INTERVAL '1 day') AT TIME ZONE 'Europe/London' AS ends_at,
      visits.meeting_point,
      visits.meet_person,
      visits.notes,
      ('jobs' = ANY(p_categories)) AS jobs_selected,
      EXISTS (
        SELECT 1 FROM public.daily_allocation_visit_labour labour
        WHERE labour.visit_id = visits.id AND 'employees' = ANY(p_categories)
      ) AS employees_selected,
      EXISTS (
        SELECT 1 FROM public.daily_allocation_visit_plant plant
        WHERE plant.visit_id = visits.id AND 'plant' = ANY(p_categories)
      ) AS plant_selected
    FROM public.daily_allocation_visits visits
    WHERE visits.plan_day_id = source_plan.id
      AND visits.owner_team_id = p_team_id
  )
  SELECT *
  FROM shifted
  WHERE jobs_selected OR employees_selected OR plant_selected;

  DROP TABLE IF EXISTS pg_temp.daily_allocation_copy_actions;
  CREATE TEMP TABLE daily_allocation_copy_actions (
    kind TEXT NOT NULL,
    role TEXT NOT NULL,
    source_visit_id UUID,
    profile_id UUID,
    plant_id UUID,
    hired_serial_normalized TEXT,
    hired_company_normalized TEXT,
    label TEXT NOT NULL,
    detail TEXT NOT NULL
  ) ON COMMIT DROP;

  FOR copy_row IN SELECT * FROM daily_allocation_copy_rows ORDER BY job_source_type, job_source_id, source_visit_id
  LOOP
    BEGIN
      job_row := private.apply_daily_allocation_draft_job(
        copy_row.job_source_type, copy_row.job_source_id, copy_row.job_code
      );
      UPDATE daily_allocation_copy_rows SET
        job_source_type = job_row.source_type, job_source_id = job_row.source_id,
        job_code = job_row.job_code, site_address = job_row.site_address
      WHERE source_visit_id = copy_row.source_visit_id;
      IF NOT job_row.address_valid THEN
        INSERT INTO daily_allocation_copy_actions (kind, role, source_visit_id, label, detail)
        VALUES ('warning', 'address', copy_row.source_visit_id, job_row.job_code,
          'Draft only: update the canonical job source with a reliable site address before publishing');
      END IF;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM NOT IN ('JOB_NOT_FOUND', 'JOB_AMBIGUOUS') THEN RAISE; END IF;
      INSERT INTO daily_allocation_copy_actions (kind, role, source_visit_id, label, detail)
      VALUES ('skip', 'visit', copy_row.source_visit_id, copy_row.job_code,
        'Job is inactive, missing or ambiguous in the canonical catalogue');
    END;
  END LOOP;

  INSERT INTO daily_allocation_copy_actions (
    kind, role, source_visit_id, label, detail
  )
  SELECT 'skip', 'visit', rows.source_visit_id, rows.job_code, 'Target already has this job in the same session'
  FROM daily_allocation_copy_rows rows
  WHERE NOT EXISTS (
    SELECT 1 FROM daily_allocation_copy_actions actions
    WHERE actions.source_visit_id = rows.source_visit_id AND actions.role = 'visit'
  )
  AND EXISTS (
    SELECT 1
    FROM public.daily_allocation_visits existing
    WHERE target_plan.id IS NOT NULL
      AND existing.plan_day_id = target_plan.id
      AND existing.job_source_type = rows.job_source_type
      AND existing.job_source_id = rows.job_source_id
      AND tstzrange(existing.starts_at, existing.ends_at, '[)')
        && tstzrange(rows.starts_at, rows.ends_at, '[)')
  );

  INSERT INTO daily_allocation_copy_actions (
    kind, role, source_visit_id, label, detail
  )
  SELECT
    CASE
      WHEN private.daily_allocation_is_session_interval(rows.starts_at, rows.ends_at) THEN 'addition'
      ELSE 'skip'
    END,
    'visit',
    rows.source_visit_id,
    rows.job_code,
    CASE
      WHEN private.daily_allocation_is_session_interval(rows.starts_at, rows.ends_at) THEN 'Visit'
      ELSE 'Normalize this visit to Full, AM, or PM before copying'
    END
  FROM daily_allocation_copy_rows rows
  WHERE NOT EXISTS (
    SELECT 1 FROM daily_allocation_copy_actions actions
    WHERE actions.source_visit_id = rows.source_visit_id AND actions.role = 'visit'
  );

  INSERT INTO daily_allocation_copy_actions (
    kind, role, source_visit_id, profile_id, label, detail
  )
  SELECT
    CASE
      WHEN absence.id IS NOT NULL THEN 'warning'
      WHEN existing.id IS NOT NULL OR earlier.source_visit_id IS NOT NULL THEN 'skip'
      WHEN off_shift.profile_id IS NOT NULL THEN 'skip'
      WHEN EXTRACT(ISODOW FROM p_target_date) IN (6, 7)
        AND NOT EXISTS (
          SELECT 1 FROM public.employee_work_shifts shifts
          WHERE shifts.profile_id = labour.profile_id
        ) THEN 'skip'
      ELSE 'addition'
    END,
    'labour',
    rows.source_visit_id,
    labour.profile_id,
    rows.job_code,
    CASE
      WHEN absence.id IS NOT NULL THEN 'Employee is absent for this session'
      WHEN existing.id IS NOT NULL OR earlier.source_visit_id IS NOT NULL THEN 'Employee is already booked for this session'
      WHEN off_shift.profile_id IS NOT NULL THEN 'Employee is not on shift for this session'
      WHEN EXTRACT(ISODOW FROM p_target_date) IN (6, 7)
        AND NOT EXISTS (
          SELECT 1 FROM public.employee_work_shifts shifts
          WHERE shifts.profile_id = labour.profile_id
        ) THEN 'Employee is not on shift for this session'
      ELSE 'Employee included with the copied visit'
    END
  FROM daily_allocation_copy_rows rows
  JOIN daily_allocation_copy_actions visit_action
    ON visit_action.source_visit_id = rows.source_visit_id
    AND visit_action.role = 'visit'
    AND visit_action.kind = 'addition'
  JOIN public.daily_allocation_visit_labour labour ON labour.visit_id = rows.source_visit_id
  LEFT JOIN LATERAL (
    SELECT existing_labour.id
    FROM public.daily_allocation_visit_labour existing_labour
    WHERE existing_labour.profile_id = labour.profile_id
      AND existing_labour.work_date = p_target_date
      AND tstzrange(existing_labour.starts_at, existing_labour.ends_at, '[)')
        && tstzrange(rows.starts_at, rows.ends_at, '[)')
    LIMIT 1
  ) existing ON TRUE
  LEFT JOIN LATERAL (
    SELECT other_rows.source_visit_id
    FROM daily_allocation_copy_rows other_rows
    JOIN daily_allocation_copy_actions other_visit
      ON other_visit.source_visit_id = other_rows.source_visit_id
      AND other_visit.role = 'visit'
      AND other_visit.kind = 'addition'
    JOIN public.daily_allocation_visit_labour other_labour
      ON other_labour.visit_id = other_rows.source_visit_id
    WHERE other_labour.profile_id = labour.profile_id
      AND other_rows.source_visit_id < rows.source_visit_id
      AND tstzrange(other_rows.starts_at, other_rows.ends_at, '[)')
        && tstzrange(rows.starts_at, rows.ends_at, '[)')
    LIMIT 1
  ) earlier ON TRUE
  LEFT JOIN LATERAL (
    SELECT absences.id
    FROM public.absences absences
    WHERE absences.profile_id = labour.profile_id
      AND absences.status IN ('approved', 'processed')
      AND absences.date <= p_target_date
      AND COALESCE(absences.end_date, absences.date) >= p_target_date
      AND (
        COALESCE(absences.is_half_day, FALSE) = FALSE
        OR (absences.half_day_session = 'AM' AND (rows.starts_at AT TIME ZONE 'Europe/London')::time < TIME '12:00')
        OR (absences.half_day_session = 'PM' AND (rows.ends_at AT TIME ZONE 'Europe/London')::time > TIME '12:00')
        OR (COALESCE(absences.is_half_day, FALSE) AND absences.half_day_session IS NULL)
      )
    LIMIT 1
  ) absence ON TRUE
  LEFT JOIN public.employee_work_shifts off_shift
    ON off_shift.profile_id = labour.profile_id
    AND (
      (
        (rows.starts_at AT TIME ZONE 'Europe/London')::time < TIME '12:00'
        AND NOT CASE EXTRACT(ISODOW FROM p_target_date)
          WHEN 1 THEN off_shift.monday_am
          WHEN 2 THEN off_shift.tuesday_am
          WHEN 3 THEN off_shift.wednesday_am
          WHEN 4 THEN off_shift.thursday_am
          WHEN 5 THEN off_shift.friday_am
          WHEN 6 THEN off_shift.saturday_am
          ELSE off_shift.sunday_am
        END
      )
      OR (
        (rows.ends_at AT TIME ZONE 'Europe/London')::time > TIME '12:00'
        AND NOT CASE EXTRACT(ISODOW FROM p_target_date)
          WHEN 1 THEN off_shift.monday_pm
          WHEN 2 THEN off_shift.tuesday_pm
          WHEN 3 THEN off_shift.wednesday_pm
          WHEN 4 THEN off_shift.thursday_pm
          WHEN 5 THEN off_shift.friday_pm
          WHEN 6 THEN off_shift.saturday_pm
          ELSE off_shift.sunday_pm
        END
      )
    )
  WHERE rows.employees_selected OR rows.jobs_selected OR rows.plant_selected;

  INSERT INTO daily_allocation_copy_actions (
    kind, role, source_visit_id, plant_id, hired_serial_normalized, hired_company_normalized, label, detail
  )
  SELECT
    CASE
      WHEN existing.id IS NOT NULL OR earlier.source_visit_id IS NOT NULL THEN 'skip'
      ELSE 'addition'
    END,
    'plant',
    rows.source_visit_id,
    plant.plant_id,
    plant.hired_serial_normalized,
    plant.hired_company_normalized,
    rows.job_code,
    CASE
      WHEN existing.id IS NOT NULL OR earlier.source_visit_id IS NOT NULL THEN 'Plant is already on another job that day'
      ELSE 'Plant included with the copied visit'
    END
  FROM daily_allocation_copy_rows rows
  JOIN daily_allocation_copy_actions visit_action
    ON visit_action.source_visit_id = rows.source_visit_id
    AND visit_action.role = 'visit'
    AND visit_action.kind = 'addition'
  JOIN public.daily_allocation_visit_plant plant ON plant.visit_id = rows.source_visit_id
  LEFT JOIN LATERAL (
    SELECT existing_plant.id
    FROM public.daily_allocation_visit_plant existing_plant
    JOIN public.daily_allocation_visits existing_visit ON existing_visit.id = existing_plant.visit_id
    WHERE existing_plant.work_date = p_target_date
      AND (
        (plant.plant_id IS NOT NULL AND existing_plant.plant_id = plant.plant_id)
        OR (
          plant.plant_kind = 'hired'
          AND existing_plant.hired_serial_normalized = plant.hired_serial_normalized
          AND existing_plant.hired_company_normalized = plant.hired_company_normalized
        )
      )
      AND (
        existing_visit.job_source_type IS DISTINCT FROM rows.job_source_type
        OR existing_visit.job_source_id IS DISTINCT FROM rows.job_source_id
      )
    LIMIT 1
  ) existing ON TRUE
  LEFT JOIN LATERAL (
    SELECT other_rows.source_visit_id
    FROM daily_allocation_copy_rows other_rows
    JOIN public.daily_allocation_visit_plant other_plant
      ON other_plant.visit_id = other_rows.source_visit_id
    WHERE other_rows.source_visit_id < rows.source_visit_id
      AND (
        other_rows.job_source_type IS DISTINCT FROM rows.job_source_type
        OR other_rows.job_source_id IS DISTINCT FROM rows.job_source_id
      )
      AND (
        (plant.plant_id IS NOT NULL AND other_plant.plant_id = plant.plant_id)
        OR (
          plant.plant_kind = 'hired'
          AND other_plant.hired_serial_normalized = plant.hired_serial_normalized
          AND other_plant.hired_company_normalized = plant.hired_company_normalized
        )
      )
    LIMIT 1
  ) earlier ON TRUE
  WHERE rows.plant_selected;

  DELETE FROM daily_allocation_copy_actions visit_action
  USING daily_allocation_copy_rows rows
  WHERE visit_action.role = 'visit'
    AND visit_action.kind = 'addition'
    AND visit_action.source_visit_id = rows.source_visit_id
    AND NOT rows.jobs_selected
    AND NOT EXISTS (
      SELECT 1 FROM daily_allocation_copy_actions resource_action
      WHERE resource_action.source_visit_id = rows.source_visit_id
        AND resource_action.kind = 'addition'
        AND resource_action.role IN ('labour', 'plant')
    );

  IF target_plan.id IS NULL AND (
    EXISTS (
      SELECT 1
      FROM public.daily_labour_allocation_drafts drafts
      JOIN public.profiles profiles ON profiles.id = drafts.profile_id
      WHERE drafts.work_date = p_target_date
        AND profiles.team_id = p_team_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.daily_plant_allocation_drafts drafts
      WHERE drafts.work_date = p_target_date
        AND drafts.owner_team_id = p_team_id
    )
  ) THEN
    RAISE EXCEPTION 'TARGET_NEEDS_CONVERSION';
  END IF;

  IF p_apply AND EXISTS (
    SELECT 1 FROM daily_allocation_copy_actions WHERE kind = 'addition'
  ) THEN
    IF target_plan.id IS NULL THEN
      INSERT INTO public.daily_allocation_plan_days (
        work_date, team_id, plan_version, converted_by, created_by, updated_by
      ) VALUES (
        p_target_date, p_team_id, 1, actor_id, actor_id, actor_id
      ) RETURNING * INTO target_plan;
    END IF;

    PERFORM private.lock_daily_allocation_resource_keys(
      COALESCE((
        SELECT array_agg(DISTINCT labour.profile_id ORDER BY labour.profile_id)
        FROM daily_allocation_copy_rows rows
        JOIN public.daily_allocation_visit_labour labour ON labour.visit_id = rows.source_visit_id
        JOIN daily_allocation_copy_actions actions
          ON actions.source_visit_id = rows.source_visit_id
          AND actions.role = 'labour'
          AND actions.kind = 'addition'
          AND actions.profile_id = labour.profile_id
      ), ARRAY[]::UUID[]),
      COALESCE((
        SELECT array_agg(DISTINCT plant.plant_id ORDER BY plant.plant_id)
        FROM daily_allocation_copy_rows rows
        JOIN public.daily_allocation_visit_plant plant ON plant.visit_id = rows.source_visit_id
        JOIN daily_allocation_copy_actions actions
          ON actions.source_visit_id = rows.source_visit_id
          AND actions.role = 'plant'
          AND actions.kind = 'addition'
          AND actions.plant_id = plant.plant_id
        WHERE plant.plant_id IS NOT NULL
      ), ARRAY[]::UUID[]),
      COALESCE((
        SELECT array_agg(DISTINCT (plant.hired_serial_normalized || ':' || plant.hired_company_normalized)
          ORDER BY (plant.hired_serial_normalized || ':' || plant.hired_company_normalized))
        FROM daily_allocation_copy_rows rows
        JOIN public.daily_allocation_visit_plant plant ON plant.visit_id = rows.source_visit_id
        JOIN daily_allocation_copy_actions actions
          ON actions.source_visit_id = rows.source_visit_id
          AND actions.role = 'plant'
          AND actions.kind = 'addition'
          AND actions.hired_serial_normalized = plant.hired_serial_normalized
          AND actions.hired_company_normalized = plant.hired_company_normalized
        WHERE plant.plant_kind = 'hired'
          AND plant.hired_serial_normalized IS NOT NULL
          AND plant.hired_company_normalized IS NOT NULL
      ), ARRAY[]::TEXT[])
    );

    FOR copy_row IN
      SELECT DISTINCT rows.job_source_type, rows.job_source_id
      FROM daily_allocation_copy_rows rows
      JOIN daily_allocation_copy_actions actions ON actions.source_visit_id = rows.source_visit_id
        AND actions.role = 'visit' AND actions.kind = 'addition'
      ORDER BY rows.job_source_type, rows.job_source_id
    LOOP
      PERFORM private.daily_allocation_v2_lock_job_source(copy_row.job_source_type, copy_row.job_source_id);
    END LOOP;

    target_plan.plan_version := private.bump_daily_allocation_plan_version(
      target_plan.id,
      target_plan.plan_version,
      actor_id
    );

    INSERT INTO public.daily_allocation_visits (
      id, plan_day_id, work_date, owner_team_id, job_source_type, job_source_id,
      job_code, site_address, starts_at, ends_at, meeting_point, meet_person, notes,
      created_by, updated_by
    )
    SELECT
      rows.new_visit_id, target_plan.id, p_target_date, p_team_id, rows.job_source_type,
      rows.job_source_id, rows.job_code, rows.site_address, rows.starts_at, rows.ends_at,
      rows.meeting_point, rows.meet_person, rows.notes, actor_id, actor_id
    FROM daily_allocation_copy_rows rows
    JOIN daily_allocation_copy_actions actions
      ON actions.source_visit_id = rows.source_visit_id
      AND actions.role = 'visit'
      AND actions.kind = 'addition';

    INSERT INTO public.daily_allocation_visit_labour (
      visit_id, plan_day_id, work_date, profile_id, starts_at, ends_at,
      meeting_point, meet_person, notes, created_by, updated_by
    )
    SELECT
      rows.new_visit_id, target_plan.id, p_target_date, labour.profile_id,
      rows.starts_at, rows.ends_at, labour.meeting_point, labour.meet_person,
      labour.notes, actor_id, actor_id
    FROM daily_allocation_copy_rows rows
    JOIN public.daily_allocation_visit_labour labour ON labour.visit_id = rows.source_visit_id
    JOIN daily_allocation_copy_actions actions
      ON actions.source_visit_id = rows.source_visit_id
      AND actions.role = 'labour'
      AND actions.kind = 'addition'
      AND actions.profile_id = labour.profile_id;

    INSERT INTO public.daily_allocation_visit_plant (
      visit_id, plan_day_id, work_date, plant_kind, plant_id, hired_serial,
      hired_description, hired_company, owner_team_id, starts_at, ends_at, notes,
      created_by, updated_by
    )
    SELECT
      rows.new_visit_id, target_plan.id, p_target_date, plant.plant_kind, plant.plant_id,
      plant.hired_serial, plant.hired_description, plant.hired_company, plant.owner_team_id,
      rows.starts_at, rows.ends_at, plant.notes, actor_id, actor_id
    FROM daily_allocation_copy_rows rows
    JOIN public.daily_allocation_visit_plant plant ON plant.visit_id = rows.source_visit_id
    JOIN daily_allocation_copy_actions actions
      ON actions.source_visit_id = rows.source_visit_id
      AND actions.role = 'plant'
      AND actions.kind = 'addition'
      AND actions.plant_id IS NOT DISTINCT FROM plant.plant_id
      AND actions.hired_serial_normalized IS NOT DISTINCT FROM plant.hired_serial_normalized
      AND actions.hired_company_normalized IS NOT DISTINCT FROM plant.hired_company_normalized;

  END IF;

  result := jsonb_build_object(
    'applied', p_apply,
    'source_date', p_source_date,
    'target_date', p_target_date,
    'target_plan_version', CASE WHEN p_apply THEN target_plan.plan_version ELSE target_plan.plan_version END,
    'additions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', label, 'detail', detail) ORDER BY label)
      FROM daily_allocation_copy_actions WHERE kind = 'addition'
    ), '[]'::jsonb),
    'skips', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', label, 'detail', detail) ORDER BY label)
      FROM daily_allocation_copy_actions WHERE kind = 'skip'
    ), '[]'::jsonb),
    'warnings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', label, 'detail', detail) ORDER BY label)
      FROM daily_allocation_copy_actions WHERE kind = 'warning'
    ), '[]'::jsonb)
  );
  IF NOT p_apply THEN
    RETURN result;
  END IF;
  RETURN private.daily_allocation_request_store(p_request_id, actor_id, 'plan_copy', payload, result);
END;
$$;

COMMIT;
