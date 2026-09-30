-- finalise-phase: predeploy
BEGIN;

ALTER TABLE private.daily_allocation_mutation_requests
  DROP CONSTRAINT IF EXISTS daily_allocation_mutation_requests_action_check;

ALTER TABLE private.daily_allocation_mutation_requests
  ADD CONSTRAINT daily_allocation_mutation_requests_action_check CHECK (
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
      'publish',
      'plan_copy',
      'session_normalize'
    )
  );

CREATE OR REPLACE FUNCTION private.daily_allocation_is_session_interval(
  p_starts TIMESTAMPTZ,
  p_ends TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_starts IS NOT NULL
    AND p_ends IS NOT NULL
    AND (p_starts AT TIME ZONE 'Europe/London')::date = (p_ends AT TIME ZONE 'Europe/London')::date
    AND (
      ((p_starts AT TIME ZONE 'Europe/London')::time, (p_ends AT TIME ZONE 'Europe/London')::time)
      IN (
        (TIME '07:00', TIME '16:30'),
        (TIME '07:00', TIME '12:00'),
        (TIME '12:00', TIME '16:30')
      )
    );
$$;

CREATE OR REPLACE FUNCTION private.daily_allocation_session_bounds(p_session TEXT)
RETURNS TABLE(start_time TIME, end_time TIME)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_session
    WHEN 'am' THEN TIME '07:00'
    WHEN 'pm' THEN TIME '12:00'
    ELSE TIME '07:00'
  END,
  CASE p_session
    WHEN 'am' THEN TIME '12:00'
    WHEN 'pm' THEN TIME '16:30'
    ELSE TIME '16:30'
  END;
$$;

CREATE OR REPLACE FUNCTION private.enforce_daily_allocation_visit_session()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, private
AS $$
BEGIN
  IF NOT private.daily_allocation_is_session_interval(NEW.starts_at, NEW.ends_at) THEN
    RAISE EXCEPTION 'VALIDATION' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS daily_allocation_visits_session_guard ON public.daily_allocation_visits;
CREATE TRIGGER daily_allocation_visits_session_guard
  BEFORE INSERT OR UPDATE OF starts_at, ends_at
  ON public.daily_allocation_visits
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_daily_allocation_visit_session();

ALTER TABLE public.daily_allocation_visit_labour
  DROP CONSTRAINT IF EXISTS daily_allocation_visit_labour_excl_overlap;
ALTER TABLE public.daily_allocation_visit_labour
  ADD CONSTRAINT daily_allocation_visit_labour_excl_overlap
  EXCLUDE USING gist (
    profile_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE public.daily_allocation_visit_plant
  DROP CONSTRAINT IF EXISTS daily_allocation_visit_plant_registered_excl_overlap;
ALTER TABLE public.daily_allocation_visit_plant
  ADD CONSTRAINT daily_allocation_visit_plant_registered_excl_overlap
  EXCLUDE USING gist (
    plant_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (plant_kind = 'registered' AND plant_id IS NOT NULL)
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE public.daily_allocation_visit_plant
  DROP CONSTRAINT IF EXISTS daily_allocation_visit_plant_hired_excl_overlap;
ALTER TABLE public.daily_allocation_visit_plant
  ADD CONSTRAINT daily_allocation_visit_plant_hired_excl_overlap
  EXCLUDE USING gist (
    hired_serial_normalized WITH =,
    hired_company_normalized WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (plant_kind = 'hired')
  DEFERRABLE INITIALLY IMMEDIATE;

CREATE OR REPLACE FUNCTION public.list_daily_allocation_plant_conflicts_range(
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE (
  work_date DATE,
  plant_id UUID,
  hired_serial TEXT,
  hired_company TEXT,
  owner_team_id TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
  SELECT
    drafts.work_date,
    drafts.plant_id,
    drafts.hired_serial,
    drafts.hired_company,
    drafts.owner_team_id
  FROM public.daily_plant_allocation_drafts drafts
  WHERE drafts.work_date BETWEEN p_start_date AND p_end_date
    AND public.effective_has_module_level('daily-allocation', 4)
    AND NOT (
      public.effective_module_access_level('daily-allocation') >= 5
      OR public.can_actor_manage_daily_allocation_team(drafts.owner_team_id)
    );
$$;

REVOKE ALL ON FUNCTION public.list_daily_allocation_plant_conflicts_range(DATE, DATE)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.list_daily_allocation_plant_conflicts_range(DATE, DATE)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.list_my_daily_allocation_issued_plant()
RETURNS TABLE (
  publication_id UUID,
  published_visit_id UUID,
  plant_kind TEXT,
  label TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
  SELECT
    plant_row.publication_id,
    plant_row.published_visit_id,
    plant_row.plant_kind,
    CASE
      WHEN plant_row.plant_kind = 'registered' THEN COALESCE(asset.plant_id, 'Plant')
      ELSE COALESCE(NULLIF(BTRIM(plant_row.hired_serial), ''), 'Hired plant')
    END
  FROM public.daily_allocation_published_plant plant_row
  JOIN public.daily_allocation_published_labour labour
    ON labour.publication_id = plant_row.publication_id
   AND labour.published_visit_id = plant_row.published_visit_id
   AND labour.profile_id = auth.uid()
  LEFT JOIN public.plant asset ON asset.id = plant_row.plant_id
  WHERE public.effective_has_module_level('daily-allocation', 2);
$$;

REVOKE ALL ON FUNCTION public.list_my_daily_allocation_issued_plant()
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.list_my_daily_allocation_issued_plant()
  TO authenticated;

CREATE OR REPLACE FUNCTION public.normalize_daily_allocation_sessions_v2(
  p_request_id UUID,
  p_team_id TEXT,
  p_work_date DATE,
  p_expected_plan_version INTEGER,
  p_apply BOOLEAN,
  p_adjustments JSONB
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
  result JSONB;
  conflict_count INTEGER;
  updated_count INTEGER;
BEGIN
  actor_id := private.require_daily_allocation_v2_writer();
  IF NOT public.can_actor_manage_daily_allocation_team(p_team_id) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF p_request_id IS NULL OR p_work_date IS NULL OR p_apply IS NULL
    OR p_expected_plan_version IS NULL OR NULLIF(BTRIM(p_team_id), '') IS NULL THEN
    RAISE EXCEPTION 'VALIDATION';
  END IF;
  IF p_adjustments IS NOT NULL AND jsonb_typeof(p_adjustments) <> 'array' THEN
    RAISE EXCEPTION 'VALIDATION';
  END IF;

  payload := jsonb_build_object(
    'team_id', p_team_id,
    'work_date', p_work_date,
    'expected_plan_version', p_expected_plan_version,
    'apply', p_apply,
    'adjustments', COALESCE(p_adjustments, '[]'::jsonb)
  );
  replay := private.daily_allocation_request_replay(p_request_id, actor_id, 'session_normalize', payload);
  IF replay IS NOT NULL THEN
    RETURN replay;
  END IF;

  PERFORM private.lock_daily_allocation_plan_day(p_work_date, p_team_id);
  SELECT * INTO plan_day
  FROM public.daily_allocation_plan_days
  WHERE work_date = p_work_date AND team_id = p_team_id
  FOR UPDATE;

  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1 FROM public.daily_labour_allocation_drafts drafts
      JOIN public.profiles profile ON profile.id = drafts.profile_id
      WHERE drafts.work_date = p_work_date AND profile.team_id = p_team_id
    ) OR EXISTS (
      SELECT 1 FROM public.daily_plant_allocation_drafts drafts
      WHERE drafts.work_date = p_work_date AND drafts.owner_team_id = p_team_id
    ) THEN
      RAISE EXCEPTION 'TARGET_NEEDS_CONVERSION';
    END IF;
    result := jsonb_build_object(
      'applied', FALSE,
      'work_date', p_work_date,
      'team_id', p_team_id,
      'plan_version', NULL,
      'visits', '[]'::jsonb,
      'conflicts', '[]'::jsonb
    );
    RETURN result;
  END IF;

  IF plan_day.plan_version <> p_expected_plan_version THEN
    RAISE EXCEPTION 'STALE_PLAN_VERSION';
  END IF;

  DROP TABLE IF EXISTS pg_temp.daily_allocation_session_plan;
  DROP TABLE IF EXISTS pg_temp.daily_allocation_session_conflicts;
  CREATE TEMP TABLE pg_temp.daily_allocation_session_plan (
    visit_id UUID PRIMARY KEY,
    job_code TEXT NOT NULL,
    row_version INTEGER NOT NULL,
    session TEXT NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO pg_temp.daily_allocation_session_plan (visit_id, job_code, row_version, session, starts_at, ends_at)
  SELECT
    visit.id,
    visit.job_code,
    visit.row_version,
    COALESCE(adjustment.session, proposed.session),
    (visit.work_date + bounds.start_time) AT TIME ZONE 'Europe/London',
    (visit.work_date + bounds.end_time) AT TIME ZONE 'Europe/London'
  FROM public.daily_allocation_visits visit
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN (visit.starts_at AT TIME ZONE 'Europe/London')::time <= TIME '12:00'
       AND (visit.ends_at AT TIME ZONE 'Europe/London')::time <= TIME '12:00' THEN 'am'
      WHEN (visit.starts_at AT TIME ZONE 'Europe/London')::time >= TIME '12:00'
       AND (visit.ends_at AT TIME ZONE 'Europe/London')::time >= TIME '12:00' THEN 'pm'
      ELSE 'full'
    END AS session
  ) proposed
  LEFT JOIN LATERAL (
    SELECT item->>'session' AS session
    FROM jsonb_array_elements(COALESCE(p_adjustments, '[]'::jsonb)) item
    WHERE item->>'visit_id' = visit.id::text
      AND item->>'session' IN ('full', 'am', 'pm')
  ) adjustment ON TRUE
  JOIN LATERAL private.daily_allocation_session_bounds(COALESCE(adjustment.session, proposed.session)) bounds ON TRUE
  WHERE visit.plan_day_id = plan_day.id
    AND NOT private.daily_allocation_is_session_interval(visit.starts_at, visit.ends_at);

  CREATE TEMP TABLE pg_temp.daily_allocation_session_conflicts (
    visit_id UUID NOT NULL,
    detail TEXT NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO pg_temp.daily_allocation_session_conflicts (visit_id, detail)
  SELECT planned.visit_id, 'Employee overlap'
  FROM pg_temp.daily_allocation_session_plan planned
  JOIN public.daily_allocation_visit_labour labour ON labour.visit_id = planned.visit_id
  JOIN public.daily_allocation_visit_labour other
    ON other.profile_id = labour.profile_id
   AND other.work_date = labour.work_date
   AND other.id <> labour.id
  JOIN public.daily_allocation_visits other_visit ON other_visit.id = other.visit_id
  LEFT JOIN pg_temp.daily_allocation_session_plan other_plan ON other_plan.visit_id = other.visit_id
  WHERE tstzrange(planned.starts_at, planned.ends_at, '[)')
    && tstzrange(
      COALESCE(other_plan.starts_at, other_visit.starts_at),
      COALESCE(other_plan.ends_at, other_visit.ends_at),
      '[)'
    );

  INSERT INTO pg_temp.daily_allocation_session_conflicts (visit_id, detail)
  SELECT planned.visit_id, 'Plant overlap'
  FROM pg_temp.daily_allocation_session_plan planned
  JOIN public.daily_allocation_visit_plant plant ON plant.visit_id = planned.visit_id
  JOIN public.daily_allocation_visit_plant other
    ON other.work_date = plant.work_date
   AND other.id <> plant.id
   AND other.plant_kind = plant.plant_kind
   AND other.plant_id IS NOT DISTINCT FROM plant.plant_id
   AND other.hired_serial_normalized IS NOT DISTINCT FROM plant.hired_serial_normalized
   AND other.hired_company_normalized IS NOT DISTINCT FROM plant.hired_company_normalized
  JOIN public.daily_allocation_visits other_visit ON other_visit.id = other.visit_id
  LEFT JOIN pg_temp.daily_allocation_session_plan other_plan ON other_plan.visit_id = other.visit_id
  WHERE tstzrange(planned.starts_at, planned.ends_at, '[)')
    && tstzrange(
      COALESCE(other_plan.starts_at, other_visit.starts_at),
      COALESCE(other_plan.ends_at, other_visit.ends_at),
      '[)'
    );

  SELECT COUNT(*) INTO conflict_count FROM pg_temp.daily_allocation_session_conflicts;
  result := jsonb_build_object(
    'applied', FALSE,
    'work_date', p_work_date,
    'team_id', p_team_id,
    'plan_day_id', plan_day.id,
    'plan_version', plan_day.plan_version,
    'visits', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'visit_id', planned.visit_id,
        'job_code', planned.job_code,
        'row_version', planned.row_version,
        'session', planned.session,
        'starts_at', planned.starts_at,
        'ends_at', planned.ends_at
      ) ORDER BY planned.job_code)
      FROM pg_temp.daily_allocation_session_plan planned
    ), '[]'::jsonb),
    'conflicts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('visit_id', visit_id, 'detail', detail) ORDER BY detail)
      FROM pg_temp.daily_allocation_session_conflicts
    ), '[]'::jsonb)
  );

  IF NOT p_apply THEN
    RETURN result;
  END IF;
  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'CONFLICT';
  END IF;

  SET CONSTRAINTS
    daily_allocation_visit_labour_excl_overlap,
    daily_allocation_visit_plant_registered_excl_overlap,
    daily_allocation_visit_plant_hired_excl_overlap
    DEFERRED;

  UPDATE public.daily_allocation_visits visit
  SET starts_at = planned.starts_at,
      ends_at = planned.ends_at,
      row_version = visit.row_version + 1,
      updated_at = NOW(),
      updated_by = actor_id
  FROM pg_temp.daily_allocation_session_plan planned
  WHERE visit.id = planned.visit_id
    AND visit.row_version = planned.row_version;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> (SELECT COUNT(*) FROM pg_temp.daily_allocation_session_plan) THEN
    RAISE EXCEPTION 'STALE_PLAN_VERSION';
  END IF;

  UPDATE public.daily_allocation_visit_labour labour
  SET starts_at = planned.starts_at,
      ends_at = planned.ends_at,
      row_version = labour.row_version + 1,
      updated_at = NOW()
  FROM pg_temp.daily_allocation_session_plan planned
  WHERE labour.visit_id = planned.visit_id;

  UPDATE public.daily_allocation_visit_plant plant
  SET starts_at = planned.starts_at,
      ends_at = planned.ends_at,
      row_version = plant.row_version + 1,
      updated_at = NOW()
  FROM pg_temp.daily_allocation_session_plan planned
  WHERE plant.visit_id = planned.visit_id;

  UPDATE public.daily_allocation_plan_days
  SET plan_version = plan_version + 1,
      updated_at = NOW()
  WHERE id = plan_day.id
    AND plan_version = p_expected_plan_version;

  result := jsonb_set(result, '{applied}', 'true'::jsonb);
  result := jsonb_set(result, '{plan_version}', to_jsonb(p_expected_plan_version + 1));
  RETURN private.daily_allocation_request_store(
    p_request_id,
    actor_id,
    'session_normalize',
    payload,
    result
  );
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_daily_allocation_sessions_v2(UUID, TEXT, DATE, INTEGER, BOOLEAN, JSONB)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.normalize_daily_allocation_sessions_v2(UUID, TEXT, DATE, INTEGER, BOOLEAN, JSONB)
  TO authenticated;

-- Copy keeps its insert-only behaviour, but a custom interval is skipped until it is a session.
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

  INSERT INTO daily_allocation_copy_actions (
    kind, role, source_visit_id, label, detail
  )
  SELECT 'skip', 'visit', rows.source_visit_id, rows.job_code, 'Job is no longer in the catalogue'
  FROM daily_allocation_copy_rows rows
  WHERE NOT (
    (rows.job_source_type = 'live_quote' AND EXISTS (
      SELECT 1 FROM public.quotes quote WHERE quote.id = rows.job_source_id
    ))
    OR (rows.job_source_type = 'legacy_quote' AND EXISTS (
      SELECT 1 FROM public.legacy_quotes quote WHERE quote.id = rows.job_source_id
    ))
    OR (rows.job_source_type = 'project_number' AND EXISTS (
      SELECT 1 FROM public.quote_project_numbers project WHERE project.id = rows.job_source_id
    ))
  );

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
