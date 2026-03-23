BEGIN;

CREATE OR REPLACE FUNCTION public.view_as_team_id()
RETURNS TEXT AS $$
DECLARE
  headers_json TEXT;
  team_id_str TEXT;
BEGIN
  headers_json := current_setting('request.headers', true);
  IF headers_json IS NULL OR headers_json = '' THEN
    RETURN NULL;
  END IF;

  team_id_str := headers_json::json ->> 'x-view-as-team-id';
  IF team_id_str IS NULL OR team_id_str = '' THEN
    RETURN NULL;
  END IF;

  RETURN team_id_str;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.effective_team_id()
RETURNS TEXT AS $$
DECLARE
  actual_team_id TEXT;
  override_team_id TEXT;
BEGIN
  SELECT p.team_id
  INTO actual_team_id
  FROM profiles p
  WHERE p.id = auth.uid();

  IF NOT public.is_actual_super_admin() THEN
    RETURN actual_team_id;
  END IF;

  override_team_id := public.view_as_team_id();
  IF override_team_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM org_teams WHERE id = override_team_id) THEN
    RETURN override_team_id;
  END IF;

  RETURN actual_team_id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.effective_has_module_permission(module TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  eff_role_id UUID;
  eff_team_id TEXT;
BEGIN
  eff_role_id := public.effective_role_id();
  eff_team_id := public.effective_team_id();

  RETURN public.role_on_team_has_module_permission(eff_role_id, eff_team_id, module);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

DROP FUNCTION IF EXISTS public.get_user_permissions(UUID);

CREATE FUNCTION public.get_user_permissions(user_id UUID)
RETURNS TABLE (module_name TEXT, enabled BOOLEAN) AS $$
DECLARE
  target_role_id UUID;
  target_team_id TEXT;
BEGIN
  IF user_id = auth.uid() THEN
    target_role_id := public.effective_role_id();
    target_team_id := public.effective_team_id();
  ELSE
    SELECT p.role_id, p.team_id
    INTO target_role_id, target_team_id
    FROM profiles p
    WHERE p.id = user_id;
  END IF;

  RETURN QUERY
  SELECT
    pm.module_name,
    public.role_on_team_has_module_permission(target_role_id, target_team_id, pm.module_name) AS enabled
  FROM permission_modules pm
  ORDER BY pm.sort_order;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

COMMIT;
