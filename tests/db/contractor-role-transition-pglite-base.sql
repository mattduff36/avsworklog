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
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.role', true), '');
$$;

CREATE TABLE public.roles (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  display_name text NOT NULL
);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  role_id uuid REFERENCES public.roles(id),
  full_name text NOT NULL,
  deleted_at timestamptz,
  is_system_account boolean NOT NULL DEFAULT false,
  annual_holiday_allowance_days numeric(6,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.absence_reasons (
  id uuid PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE public.absence_bulk_batches (
  id uuid PRIMARY KEY
);

CREATE TABLE public.absences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id),
  date date NOT NULL,
  reason_id uuid NOT NULL REFERENCES public.absence_reasons(id),
  status text NOT NULL DEFAULT 'approved',
  is_bank_holiday boolean NOT NULL DEFAULT false,
  auto_generated boolean NOT NULL DEFAULT false,
  bulk_batch_id uuid REFERENCES public.absence_bulk_batches(id)
);

CREATE TABLE public.absence_allowance_carryovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id),
  financial_year_start_year integer NOT NULL,
  carried_days numeric(6,2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.user_module_permissions (
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  module_name text NOT NULL,
  access_level integer NOT NULL,
  PRIMARY KEY (user_id, module_name)
);

CREATE TABLE public.timesheet_entry_leave_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  absence_id uuid NOT NULL
);

CREATE TABLE public.timesheet_bank_holiday_work_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  absence_id uuid NOT NULL REFERENCES public.absences(id) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION public.absence_financial_year_start_year(target_date date)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN EXTRACT(MONTH FROM target_date) < 4
    THEN EXTRACT(YEAR FROM target_date)::integer - 1
    ELSE EXTRACT(YEAR FROM target_date)::integer
  END;
$$;

CREATE OR REPLACE FUNCTION public.absence_is_closed_financial_year(target_date date)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT CURRENT_DATE > make_date(
    public.absence_financial_year_start_year(target_date) + 1,
    3,
    31
  );
$$;

CREATE OR REPLACE FUNCTION public.guard_test_absence_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(current_setting('app.absence_historic_delete_bypass', true), '') = 'on' THEN
    RETURN OLD;
  END IF;
  IF OLD.status IN ('approved', 'processed') THEN
    RAISE EXCEPTION 'Approved absence delete requires bypass';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_guard_test_absence_delete
  BEFORE DELETE ON public.absences
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_test_absence_delete();
