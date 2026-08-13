-- finalise-phase: postdeploy
BEGIN;

-- Install strict Plant Daily Check submission enforcement only after the
-- compatible application version is confirmed in production.
CREATE OR REPLACE FUNCTION private.guard_plant_inspection_job_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job private.allocation_job;
BEGIN
  IF NEW.job_source_type IS NULL
    AND NEW.job_source_id IS NULL
    AND NULLIF(BTRIM(COALESCE(NEW.job_code, '')), '') IS NULL THEN
    NEW.job_site_address := NULL;
    IF NEW.status = 'submitted' THEN
      IF TG_OP = 'UPDATE'
        AND OLD.status = 'submitted'
        AND OLD.job_source_type IS NULL
        AND OLD.job_source_id IS NULL
        AND NULLIF(BTRIM(COALESCE(OLD.job_code, '')), '') IS NULL THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'JOB_REQUIRED';
    END IF;
    RETURN NEW;
  END IF;

  v_job := private.apply_allocation_job_fields(
    NEW.job_source_type,
    NEW.job_source_id,
    NEW.job_code,
    NEW.status = 'submitted'
  );
  IF v_job IS NULL THEN
    NEW.job_source_type := NULL;
    NEW.job_source_id := NULL;
    NEW.job_code := NULL;
    NEW.job_site_address := NULL;
    RETURN NEW;
  END IF;

  NEW.job_source_type := v_job.source_type;
  NEW.job_source_id := v_job.source_id;
  NEW.job_code := v_job.job_code;
  NEW.job_site_address := v_job.site_address;
  RETURN NEW;
END;
$$;

INSERT INTO public.permission_modules (module_name, minimum_role_id, sort_order, access_mode)
SELECT 'daily-allocation', roles.id, 206, 'team'
FROM public.roles
WHERE roles.name = 'contractor'
ON CONFLICT (module_name) DO UPDATE
SET minimum_role_id = EXCLUDED.minimum_role_id,
    sort_order = EXCLUDED.sort_order,
    access_mode = EXCLUDED.access_mode,
    updated_at = NOW();

INSERT INTO public.role_permissions (role_id, module_name, enabled)
SELECT roles.id, 'daily-allocation', FALSE
FROM public.roles
ON CONFLICT (role_id, module_name) DO NOTHING;

INSERT INTO public.team_module_permissions (team_id, module_name, enabled)
SELECT org_teams.id, 'daily-allocation', TRUE
FROM public.org_teams
WHERE org_teams.active = TRUE
ON CONFLICT (team_id, module_name) DO UPDATE
SET enabled = EXCLUDED.enabled,
    updated_at = NOW();

COMMIT;
