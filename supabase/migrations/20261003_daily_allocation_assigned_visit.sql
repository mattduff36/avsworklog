-- finalise-phase: predeploy
-- Atomic job drop: create the visit, optional audited override, and labour
-- assignment in one transaction with a single plan-version bump.
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
      'session_normalize',
      'assigned_visit_create'
    )
  );

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

  job_row := private.apply_allocation_job_fields(
    p_job_source_type,
    p_job_source_id,
    p_job_code,
    TRUE
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

REVOKE ALL ON FUNCTION public.create_daily_allocation_assigned_visit_v2(
  UUID, UUID, INTEGER, UUID, TEXT, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_daily_allocation_assigned_visit_v2(
  UUID, UUID, INTEGER, UUID, TEXT, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT
) TO authenticated;

COMMIT;
