-- finalise-phase: predeploy
-- Preserve submitted Plant Daily Check job snapshots during reading corrections.
BEGIN;

CREATE OR REPLACE FUNCTION private.guard_plant_inspection_job_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job private.allocation_job;
BEGIN
  -- Reading corrections must retain historical job snapshots, including jobs
  -- no longer active in today's catalogue. Changes to any job field still
  -- use the existing validation below, as do drafts and new submissions.
  IF TG_OP = 'UPDATE' AND OLD.status = 'submitted' AND NEW.status = 'submitted'
    AND NEW.job_source_type IS NOT DISTINCT FROM OLD.job_source_type
    AND NEW.job_source_id IS NOT DISTINCT FROM OLD.job_source_id
    AND NEW.job_code IS NOT DISTINCT FROM OLD.job_code
    AND NEW.job_site_address IS NOT DISTINCT FROM OLD.job_site_address THEN
    RETURN NEW;
  END IF;
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

  v_job := private.apply_plant_inspection_job_fields(
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
