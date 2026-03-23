BEGIN;

-- Org V2 is now the only supported hierarchy mode.
UPDATE org_teams
SET active = TRUE
WHERE active = FALSE;

INSERT INTO org_team_feature_modes (team_id, workflow_name, mode, effective_from)
SELECT
  t.id,
  'absence_leave',
  'org_v2',
  NOW()
FROM org_teams t
WHERE t.active = TRUE
ON CONFLICT (team_id, workflow_name) DO UPDATE
SET
  mode = 'org_v2',
  effective_from = COALESCE(org_team_feature_modes.effective_from, EXCLUDED.effective_from),
  updated_at = NOW();

ALTER TABLE org_team_feature_modes
  ALTER COLUMN mode SET DEFAULT 'org_v2';

ALTER TABLE org_team_feature_modes
  DROP CONSTRAINT IF EXISTS org_team_feature_modes_mode_check;

ALTER TABLE org_team_feature_modes
  ADD CONSTRAINT org_team_feature_modes_mode_check
  CHECK (mode IN ('org_v2'));

INSERT INTO team_module_permissions (team_id, module_name, enabled)
SELECT
  t.id,
  pm.module_name,
  FALSE
FROM org_teams t
CROSS JOIN permission_modules pm
LEFT JOIN team_module_permissions tmp
  ON tmp.team_id = t.id
 AND tmp.module_name = pm.module_name
WHERE t.active = TRUE
  AND tmp.team_id IS NULL;

DELETE FROM roles r
WHERE lower(r.name) IN (
  'employee-civils',
  'employee-transport',
  'employee-groundworks',
  'employee-plant',
  'employee-workshop',
  'managing-director',
  'sheq-manager',
  'company-accountant-manager',
  'heavy-plant-earthworks-contracts-manager',
  'civils-project-manager',
  'civils-contracts-manager',
  'civils-manager',
  'transport-manager',
  'workshop-manager',
  'civils-site-managers-supervisors-manager'
)
AND NOT EXISTS (
  SELECT 1
  FROM profiles p
  WHERE p.role_id = r.id
)
AND NOT EXISTS (
  SELECT 1
  FROM permission_modules pm
  WHERE pm.minimum_role_id = r.id
);

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
BEGIN
  RETURN 'org_v2';
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

  RETURN is_actor_line_manager_of(actor_profile_id, requester_profile_id);
END;
$$;

COMMIT;
