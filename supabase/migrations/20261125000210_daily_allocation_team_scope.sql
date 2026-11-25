-- finalise-phase: predeploy
BEGIN;

-- Keep the assigned module grant. A supervisor's grant cannot bypass team
-- ownership, and View As uses the selected role's team grant.
CREATE OR REPLACE FUNCTION public.effective_module_access_level(module TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_id UUID := auth.uid();
  access_level INTEGER;
BEGIN
  IF module = 'reminders' AND actor_id IS NOT NULL THEN
    RETURN 5;
  END IF;

  IF module = 'daily-allocation'
    AND public.is_actual_super_admin()
    AND public.view_as_role_id() IS NOT NULL
  THEN
    actor_id := NULL;
  END IF;

  access_level := public.user_module_access_level(
    actor_id, public.effective_role_id(), public.effective_team_id(), module
  );

  IF module = 'daily-allocation' AND public.effective_is_supervisor() AND access_level > 4 THEN
    RETURN 4;
  END IF;

  RETURN access_level;
END;
$$;

CREATE OR REPLACE FUNCTION private.daily_allocation_has_all_team_scope(access_level INTEGER)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT access_level >= 5 OR (access_level >= 4 AND public.effective_is_manager());
$$;

REVOKE ALL ON FUNCTION private.daily_allocation_has_all_team_scope(INTEGER) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.can_actor_manage_daily_allocation_team(target_team_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  access_level INTEGER := COALESCE(public.effective_module_access_level('daily-allocation'), 0);
BEGIN
  IF auth.uid() IS NULL OR access_level < 4 THEN
    RETURN FALSE;
  END IF;

  RETURN private.daily_allocation_has_all_team_scope(access_level)
    OR COALESCE(target_team_id = public.effective_team_id(), FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION private.daily_allocation_can_manage_profile(
  target_profile_id UUID,
  include_manager_all_teams BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_id UUID := auth.uid();
  access_level INTEGER := COALESCE(public.effective_module_access_level('daily-allocation'), 0);
  target_team_id TEXT;
BEGIN
  IF actor_id IS NULL OR target_profile_id IS NULL OR access_level < 4 THEN
    RETURN FALSE;
  END IF;

  IF access_level >= 5 OR (include_manager_all_teams AND public.effective_is_manager()) THEN
    RETURN TRUE;
  END IF;

  SELECT team_id INTO target_team_id FROM public.profiles WHERE id = target_profile_id;
  IF target_team_id = public.effective_team_id() THEN
    RETURN TRUE;
  END IF;

  IF public.effective_is_supervisor() THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.profile_reporting_lines AS lines
    WHERE lines.profile_id = target_profile_id
      AND lines.manager_profile_id = actor_id
      AND lines.valid_from <= NOW()
      AND lines.valid_to IS NULL
      AND lines.relation_type IN ('primary', 'secondary')
  );
END;
$$;

REVOKE ALL ON FUNCTION private.daily_allocation_can_manage_profile(UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.can_actor_manage_daily_allocation(target_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT private.daily_allocation_can_manage_profile(target_profile_id, TRUE);
$$;

-- Legacy publishing has no selected team argument. Retain its original
-- recipient and plant scope when a manager gains all-team planning.
DO $migration$
DECLARE
  definition TEXT;
  old_profile_check TEXT := 'WHERE public.can_actor_manage_daily_allocation(profiles.id)';
  old_plant_check TEXT := 'OR public.can_actor_manage_daily_allocation_team(owner_team_id)';
BEGIN
  definition := pg_get_functiondef('private.prepare_daily_allocation_publication()'::regprocedure);
  IF (length(definition) - length(replace(definition, old_profile_check, ''))) / length(old_profile_check) <> 1 THEN
    RAISE EXCEPTION 'Unexpected legacy Daily Allocation publication profile scope';
  END IF;
  EXECUTE replace(definition, old_profile_check,
    'WHERE private.daily_allocation_can_manage_profile(profiles.id, FALSE)');

  definition := pg_get_functiondef('private.finish_daily_allocation_publication()'::regprocedure);
  IF (length(definition) - length(replace(definition, old_plant_check, ''))) / length(old_plant_check) <> 1 THEN
    RAISE EXCEPTION 'Unexpected legacy Daily Allocation publication plant scope';
  END IF;
  EXECUTE replace(definition, old_plant_check, 'OR owner_team_id = public.effective_team_id()');
END;
$migration$;

COMMIT;
