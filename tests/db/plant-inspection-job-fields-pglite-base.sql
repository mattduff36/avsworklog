-- Isolated plant inspection job-field fixture. Do not apply to production.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    JOIN pg_namespace ON pg_namespace.oid = pg_type.typnamespace
    WHERE pg_namespace.nspname = 'private'
      AND pg_type.typname = 'allocation_job'
  ) THEN
    CREATE TYPE private.allocation_job AS (
      source_type TEXT,
      source_id UUID,
      job_code TEXT,
      site_address TEXT,
      customer_name TEXT,
      title TEXT,
      address_valid BOOLEAN
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION private.compact_catalog_job_code(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT NULLIF(UPPER(regexp_replace(COALESCE(p_value, ''), '[^0-9A-Za-z]', '', 'g')), '');
$$;

CREATE TABLE public.plant_inspections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL,
  job_source_type TEXT,
  job_source_id UUID,
  job_code TEXT,
  job_site_address TEXT,
  inspection_date DATE,
  user_id UUID,
  plant_id UUID,
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT plant_inspections_job_identity_check CHECK (
    (
      job_source_type IS NULL
      AND job_source_id IS NULL
      AND job_code IS NULL
      AND job_site_address IS NULL
    )
    OR (
      job_source_type IS NOT NULL
      AND job_source_id IS NOT NULL
      AND NULLIF(BTRIM(job_code), '') IS NOT NULL
    )
  )
);

CREATE TABLE public.reminder_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_key TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'system_generated',
  dedupe_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL DEFAULT 'medium',
  title TEXT NOT NULL,
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_by UUID,
  first_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX reminder_actions_open_dedupe_key_idx
  ON public.reminder_actions (dedupe_key)
  WHERE status = 'open';

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

DROP TRIGGER IF EXISTS plant_inspections_job_fields ON public.plant_inspections;
CREATE TRIGGER plant_inspections_job_fields
  BEFORE INSERT OR UPDATE ON public.plant_inspections
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_plant_inspection_job_fields();
