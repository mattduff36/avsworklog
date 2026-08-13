-- finalise-phase: predeploy
BEGIN;

CREATE OR REPLACE FUNCTION private.guard_daily_labour_allocation_draft_write()
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
      NEW.job_source_type,
      NEW.job_source_id,
      NEW.job_code,
      TRUE
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
    NEW.updated_by := auth.uid();
  ELSE
    NEW.created_by := COALESCE(NEW.created_by, auth.uid());
    NEW.updated_by := auth.uid();
  END IF;
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
    IF public.effective_module_access_level('daily-allocation') < 5
      OR NEW.owner_team_id IS NULL THEN
      SELECT team_id INTO NEW.owner_team_id
      FROM public.profiles
      WHERE id = auth.uid();
    END IF;
    IF NOT public.can_actor_manage_daily_allocation_team(NEW.owner_team_id)
      AND public.effective_module_access_level('daily-allocation') < 5 THEN
      RAISE EXCEPTION 'Not allowed to allocate plant';
    END IF;
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
    NEW.job_source_type,
    NEW.job_source_id,
    NEW.job_code,
    TRUE
  );
  NEW.job_source_type := v_job.source_type;
  NEW.job_source_id := v_job.source_id;
  NEW.job_code := v_job.job_code;
  NEW.site_address := v_job.site_address;
  NEW.updated_by := auth.uid();
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := COALESCE(NEW.created_by, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS daily_labour_allocation_drafts_guard
  ON public.daily_labour_allocation_drafts;
CREATE TRIGGER daily_labour_allocation_drafts_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.daily_labour_allocation_drafts
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_daily_labour_allocation_draft_write();

DROP TRIGGER IF EXISTS daily_plant_allocation_drafts_guard
  ON public.daily_plant_allocation_drafts;
CREATE TRIGGER daily_plant_allocation_drafts_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.daily_plant_allocation_drafts
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_daily_plant_allocation_draft_write();

DROP FUNCTION IF EXISTS private.guard_daily_allocation_draft_write();

COMMIT;
