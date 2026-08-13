-- finalise-phase: predeploy
BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

CREATE TABLE IF NOT EXISTS private.daily_allocation_permission_lockdown_snapshots (
  snapshot_key TEXT PRIMARY KEY,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  module_rows JSONB NOT NULL,
  team_rows JSONB NOT NULL,
  user_rows JSONB NOT NULL,
  role_rows JSONB NOT NULL
);

REVOKE ALL ON TABLE private.daily_allocation_permission_lockdown_snapshots
  FROM PUBLIC, anon, authenticated;

LOCK TABLE
  public.permission_modules,
  public.team_module_permissions,
  public.user_module_permissions,
  public.role_permissions
IN SHARE ROW EXCLUSIVE MODE;

INSERT INTO private.daily_allocation_permission_lockdown_snapshots (
  snapshot_key,
  module_rows,
  team_rows,
  user_rows,
  role_rows
)
SELECT
  '20260813102922_admin_only_permissions',
  COALESCE((
    SELECT JSONB_AGG(TO_JSONB(permission_modules) ORDER BY permission_modules.module_name)
    FROM public.permission_modules
    WHERE permission_modules.module_name = 'daily-allocation'
  ), '[]'::JSONB),
  COALESCE((
    SELECT JSONB_AGG(
      TO_JSONB(team_module_permissions)
      ORDER BY team_module_permissions.team_id, team_module_permissions.module_name
    )
    FROM public.team_module_permissions
    WHERE team_module_permissions.module_name = 'daily-allocation'
  ), '[]'::JSONB),
  COALESCE((
    SELECT JSONB_AGG(
      TO_JSONB(user_module_permissions)
      ORDER BY user_module_permissions.user_id, user_module_permissions.module_name
    )
    FROM public.user_module_permissions
    WHERE user_module_permissions.module_name = 'daily-allocation'
  ), '[]'::JSONB),
  COALESCE((
    SELECT JSONB_AGG(
      TO_JSONB(role_permissions)
      ORDER BY role_permissions.role_id, role_permissions.module_name
    )
    FROM public.role_permissions
    WHERE role_permissions.module_name = 'daily-allocation'
  ), '[]'::JSONB);

INSERT INTO public.permission_modules (
  module_name,
  minimum_role_id,
  sort_order,
  access_mode
)
SELECT
  'daily-allocation',
  roles.id,
  206,
  'team'
FROM public.roles
WHERE roles.name = 'employee'
  AND roles.hierarchy_rank = 2
ON CONFLICT (module_name) DO UPDATE
SET minimum_role_id = EXCLUDED.minimum_role_id,
    sort_order = EXCLUDED.sort_order,
    access_mode = EXCLUDED.access_mode,
    updated_at = NOW();

INSERT INTO public.team_module_permissions (
  team_id,
  module_name,
  enabled,
  updated_at
)
SELECT
  org_teams.id,
  'daily-allocation',
  FALSE,
  NOW()
FROM public.org_teams
WHERE org_teams.active = TRUE
ON CONFLICT (team_id, module_name) DO UPDATE
SET enabled = FALSE,
    updated_at = NOW();

UPDATE public.team_module_permissions
SET enabled = FALSE,
    updated_at = NOW()
WHERE module_name = 'daily-allocation'
  AND enabled IS DISTINCT FROM FALSE;

UPDATE public.user_module_permissions
SET access_level = 0,
    updated_by = NULL,
    updated_at = NOW()
WHERE module_name = 'daily-allocation';

INSERT INTO public.role_permissions (
  role_id,
  module_name,
  enabled
)
SELECT
  roles.id,
  'daily-allocation',
  FALSE
FROM public.roles
ON CONFLICT (role_id, module_name) DO UPDATE
SET enabled = FALSE;

DO $$
DECLARE
  invalid_non_admin_count INTEGER;
  invalid_admin_count INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.permission_modules
    JOIN public.roles
      ON roles.id = permission_modules.minimum_role_id
    WHERE permission_modules.module_name = 'daily-allocation'
      AND permission_modules.access_mode = 'team'
      AND roles.hierarchy_rank = 2
  ) THEN
    RAISE EXCEPTION 'Daily Allocation permission module is not configured at Employee/Level 2';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.org_teams
    LEFT JOIN public.team_module_permissions
      ON team_module_permissions.team_id = org_teams.id
      AND team_module_permissions.module_name = 'daily-allocation'
    WHERE org_teams.active = TRUE
      AND team_module_permissions.enabled IS DISTINCT FROM FALSE
  ) THEN
    RAISE EXCEPTION 'An active team is missing an explicit disabled Daily Allocation default';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.team_module_permissions
    WHERE module_name = 'daily-allocation'
      AND enabled IS DISTINCT FROM FALSE
  ) THEN
    RAISE EXCEPTION 'A Daily Allocation team default remains enabled';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_module_permissions
    WHERE module_name = 'daily-allocation'
      AND access_level IS DISTINCT FROM 0
  ) THEN
    RAISE EXCEPTION 'A Daily Allocation direct user permission remains above Level 0';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.roles
    LEFT JOIN public.role_permissions
      ON role_permissions.role_id = roles.id
      AND role_permissions.module_name = 'daily-allocation'
    WHERE role_permissions.enabled IS DISTINCT FROM FALSE
  ) THEN
    RAISE EXCEPTION 'A Daily Allocation legacy role permission remains enabled or missing';
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO invalid_non_admin_count
  FROM public.profiles
  JOIN public.roles ON roles.id = profiles.role_id
  WHERE NOT (
    COALESCE(roles.is_super_admin, FALSE)
    OR roles.name = 'admin'
    OR roles.role_class = 'admin'
  )
    AND public.user_module_access_level(
      profiles.id,
      profiles.role_id,
      profiles.team_id,
      'daily-allocation'
    ) <> 0;

  IF invalid_non_admin_count <> 0 THEN
    RAISE EXCEPTION '% non-admin profiles retain effective Daily Allocation access', invalid_non_admin_count;
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO invalid_admin_count
  FROM public.profiles
  JOIN public.roles ON roles.id = profiles.role_id
  WHERE (
    COALESCE(roles.is_super_admin, FALSE)
    OR roles.name = 'admin'
    OR roles.role_class = 'admin'
  )
    AND public.user_module_access_level(
      profiles.id,
      profiles.role_id,
      profiles.team_id,
      'daily-allocation'
    ) <> 5;

  IF invalid_admin_count <> 0 THEN
    RAISE EXCEPTION '% admin profiles lost effective Daily Allocation Level 5 access', invalid_admin_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM private.daily_allocation_permission_lockdown_snapshots
    WHERE snapshot_key = '20260813102922_admin_only_permissions'
  ) THEN
    RAISE EXCEPTION 'Daily Allocation permission rollback snapshot was not captured';
  END IF;
END;
$$;

COMMIT;
