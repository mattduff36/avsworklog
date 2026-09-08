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

CREATE SCHEMA auth;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  full_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_actor_admin(uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$ SELECT false $$;

CREATE OR REPLACE FUNCTION public.can_actor_edit_absence_request(uuid, uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$ SELECT false $$;

CREATE OR REPLACE FUNCTION public.effective_is_manager_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$ SELECT false $$;

CREATE TABLE public.absence_reasons (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  is_paid boolean NOT NULL DEFAULT true
);

CREATE TABLE public.absences (
  id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES public.profiles(id),
  reason_id uuid NOT NULL REFERENCES public.absence_reasons(id),
  date date NOT NULL,
  end_date date,
  status text NOT NULL,
  is_half_day boolean NOT NULL DEFAULT false,
  is_bank_holiday boolean NOT NULL DEFAULT false,
  auto_generated boolean NOT NULL DEFAULT false,
  holiday_key text,
  allow_timesheet_work_on_leave boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.timesheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  week_ending date NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  timesheet_type text NOT NULL DEFAULT 'civils',
  template_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT timesheets_user_id_week_ending_key UNIQUE (user_id, week_ending)
);

CREATE TABLE public.timesheet_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  timesheet_id uuid NOT NULL REFERENCES public.timesheets(id) ON DELETE CASCADE,
  day_of_week integer NOT NULL,
  did_not_work boolean NOT NULL DEFAULT false,
  time_started time,
  time_finished time,
  job_number text,
  working_in_yard boolean NOT NULL DEFAULT false,
  subsistence_payment_required boolean NOT NULL DEFAULT false,
  daily_total numeric,
  night_shift boolean NOT NULL DEFAULT false,
  bank_holiday boolean NOT NULL DEFAULT false,
  remarks text,
  operator_travel_hours numeric,
  operator_yard_hours numeric,
  operator_working_hours numeric,
  machine_travel_hours numeric,
  machine_start_time time,
  machine_finish_time time,
  machine_working_hours numeric,
  machine_standing_hours numeric,
  machine_operator_hours numeric,
  maintenance_breakdown_hours numeric
);

CREATE OR REPLACE FUNCTION public.resolve_timesheet_entry_date(
  week_ending_date date,
  entry_day integer
)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT week_ending_date - (7 - entry_day)
$$;

GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
