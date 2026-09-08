CREATE SCHEMA IF NOT EXISTS auth;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN NULLIF(current_setting('request.jwt.claim.role', true), '');
END;
$$;

CREATE OR REPLACE FUNCTION public.effective_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT FALSE;
$$;

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY,
  full_name TEXT NOT NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.absence_reasons (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE public.absences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id),
  date DATE NOT NULL,
  reason_id UUID NOT NULL REFERENCES public.absence_reasons(id),
  status TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE public.absences_archive (
  id UUID PRIMARY KEY,
  profile_id UUID NOT NULL,
  date DATE NOT NULL,
  reason_id UUID NOT NULL,
  status TEXT NOT NULL
);

CREATE OR REPLACE FUNCTION public.absence_financial_year_start_year(target_date DATE)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN EXTRACT(MONTH FROM target_date) < 4
      OR (EXTRACT(MONTH FROM target_date) = 4 AND EXTRACT(DAY FROM target_date) < 6)
    THEN EXTRACT(YEAR FROM target_date)::INTEGER - 1
    ELSE EXTRACT(YEAR FROM target_date)::INTEGER
  END;
$$;

CREATE OR REPLACE FUNCTION public.absence_is_closed_financial_year(target_date DATE)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT CURRENT_DATE > make_date(public.absence_financial_year_start_year(target_date) + 1, 4, 5);
$$;

CREATE OR REPLACE FUNCTION public.guard_absence_historic_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(current_setting('app.absence_archive_move', true), '') = 'on' THEN
    RETURN OLD;
  END IF;

  IF COALESCE(current_setting('app.absence_historic_delete_bypass', true), '') = 'on' THEN
    RETURN OLD;
  END IF;

  IF public.effective_is_admin() THEN
    RETURN OLD;
  END IF;

  IF OLD.date < CURRENT_DATE THEN
    RAISE EXCEPTION 'Cannot delete past absences without admin access';
  END IF;

  IF OLD.status IN ('approved', 'processed') THEN
    RAISE EXCEPTION 'Cannot delete approved or processed absences without admin access';
  END IF;

  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_guard_absence_historic_delete
  BEFORE DELETE ON public.absences
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_absence_historic_delete();

CREATE OR REPLACE FUNCTION public.guard_absence_closed_financial_year_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_date DATE;
BEGIN
  IF COALESCE(current_setting('app.absence_archive_move', true), '') = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  target_date := CASE WHEN TG_OP = 'DELETE' THEN OLD.date ELSE NEW.date END;

  IF public.absence_is_closed_financial_year(target_date) THEN
    RAISE EXCEPTION 'Cannot modify absences from a closed financial year';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_absence_closed_fy_delete
  BEFORE DELETE ON public.absences
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_absence_closed_financial_year_mutation();
