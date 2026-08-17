-- Restores strict Plant Daily Check job validation and disables Action creation.
-- Preserves reminder_actions rows and the additive due_at column.
BEGIN;

DROP TRIGGER IF EXISTS plant_inspections_legacy_missing_site_action ON public.plant_inspections;

DROP FUNCTION IF EXISTS private.ensure_plant_legacy_missing_site_action();
DROP FUNCTION IF EXISTS private.upsert_plant_legacy_missing_site_action(UUID, UUID, TEXT, TEXT, TEXT, DATE, UUID, UUID, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS private.apply_plant_inspection_job_fields(TEXT, UUID, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS private.compact_catalog_job_code(TEXT);

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

DROP INDEX IF EXISTS public.reminder_actions_open_due_at_idx;

COMMIT;
