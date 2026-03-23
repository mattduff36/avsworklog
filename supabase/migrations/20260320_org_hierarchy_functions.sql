BEGIN;

-- ============================================================================
-- ORG HIERARCHY AUTHORIZATION HELPERS
-- ============================================================================

CREATE OR REPLACE FUNCTION effective_team_mode(
  requester_profile_id UUID,
  target_workflow_name TEXT DEFAULT 'absence_leave'
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  requester_team_id TEXT;
  resolved_mode TEXT;
BEGIN
  SELECT team_id
  INTO requester_team_id
  FROM profiles
  WHERE id = requester_profile_id;

  IF requester_team_id IS NULL THEN
    RETURN 'legacy';
  END IF;

  SELECT mode
  INTO resolved_mode
  FROM org_team_feature_modes
  WHERE team_id = requester_team_id
    AND workflow_name = target_workflow_name
  ORDER BY effective_from DESC, updated_at DESC
  LIMIT 1;

  RETURN COALESCE(resolved_mode, 'legacy');
END;
$$;

CREATE OR REPLACE FUNCTION is_actor_admin(
  actor_profile_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  role_name TEXT;
  role_class TEXT;
  role_is_super_admin BOOLEAN;
BEGIN
  IF actor_profile_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT r.name, r.role_class, COALESCE(r.is_super_admin, FALSE)
  INTO role_name, role_class, role_is_super_admin
  FROM profiles p
  JOIN roles r ON r.id = p.role_id
  WHERE p.id = actor_profile_id;

  RETURN role_class = 'admin' OR role_name = 'admin' OR role_is_super_admin = TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION is_actor_manager_admin(
  actor_profile_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  role_is_manager_admin BOOLEAN;
BEGIN
  IF actor_profile_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT COALESCE(r.is_manager_admin, FALSE)
  INTO role_is_manager_admin
  FROM profiles p
  JOIN roles r ON r.id = p.role_id
  WHERE p.id = actor_profile_id;

  RETURN role_is_manager_admin = TRUE OR is_actor_admin(actor_profile_id);
END;
$$;

CREATE OR REPLACE FUNCTION is_actor_line_manager_of(
  actor_profile_id UUID,
  requester_profile_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  direct_manager_id UUID;
  secondary_manager_id UUID;
BEGIN
  IF actor_profile_id IS NULL OR requester_profile_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT line_manager_id, profiles.secondary_manager_id
  INTO direct_manager_id, secondary_manager_id
  FROM profiles
  WHERE id = requester_profile_id;

  IF direct_manager_id = actor_profile_id OR secondary_manager_id = actor_profile_id THEN
    RETURN TRUE;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM profile_reporting_lines prl
    WHERE prl.profile_id = requester_profile_id
      AND prl.manager_profile_id = actor_profile_id
      AND (prl.valid_to IS NULL OR prl.valid_to >= NOW())
  );
END;
$$;

CREATE OR REPLACE FUNCTION can_actor_access_absence_request(
  actor_profile_id UUID,
  requester_profile_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  team_mode TEXT;
BEGIN
  IF actor_profile_id IS NULL OR requester_profile_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF actor_profile_id = requester_profile_id THEN
    RETURN TRUE;
  END IF;

  IF is_actor_admin(actor_profile_id) THEN
    RETURN TRUE;
  END IF;

  IF NOT is_actor_manager_admin(actor_profile_id) THEN
    RETURN FALSE;
  END IF;

  team_mode := effective_team_mode(requester_profile_id, 'absence_leave');
  IF team_mode = 'legacy' THEN
    RETURN TRUE;
  END IF;

  RETURN is_actor_line_manager_of(actor_profile_id, requester_profile_id);
END;
$$;

CREATE OR REPLACE FUNCTION can_actor_approve_absence_request(
  actor_profile_id UUID,
  requester_profile_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  team_mode TEXT;
BEGIN
  IF actor_profile_id IS NULL OR requester_profile_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF actor_profile_id = requester_profile_id THEN
    RETURN FALSE;
  END IF;

  IF is_actor_admin(actor_profile_id) THEN
    RETURN TRUE;
  END IF;

  IF NOT is_actor_manager_admin(actor_profile_id) THEN
    RETURN FALSE;
  END IF;

  team_mode := effective_team_mode(requester_profile_id, 'absence_leave');
  IF team_mode = 'legacy' THEN
    RETURN TRUE;
  END IF;

  RETURN is_actor_line_manager_of(actor_profile_id, requester_profile_id);
END;
$$;

COMMIT;
