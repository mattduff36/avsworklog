-- Emergency disable/rollback for Daily Allocation.
-- Preserves drafts, publications, snapshots, messages, and inspection job data.
BEGIN;

UPDATE public.team_module_permissions
SET enabled = FALSE,
    updated_at = NOW()
WHERE module_name = 'daily-allocation';

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

COMMIT;
