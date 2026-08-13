-- Isolated Daily Allocation v2 PGlite fixture. Do not apply to production.
-- Behaviorally faithful v1/Supabase base used only by tests/db runtime proofs.

DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.sub', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
$$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS private.test_actor_module_level (
  profile_id UUID PRIMARY KEY,
  daily_allocation_level INTEGER NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION public.view_as_role_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.view_as_role_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION public.effective_module_access_level(target_module TEXT)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN target_module = 'daily-allocation' THEN COALESCE((
      SELECT levels.daily_allocation_level
      FROM private.test_actor_module_level levels
      WHERE levels.profile_id = auth.uid()
    ), 0)
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION public.effective_has_module_level(target_module TEXT, minimum_level INTEGER)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.effective_module_access_level(target_module) >= minimum_level;
$$;

CREATE TABLE IF NOT EXISTS public.org_teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY,
  full_name TEXT NOT NULL,
  employee_id TEXT,
  team_id TEXT REFERENCES public.org_teams(id),
  is_placeholder BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS public.profile_reporting_lines (
  profile_id UUID NOT NULL,
  manager_profile_id UUID NOT NULL,
  valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_to TIMESTAMPTZ,
  relation_type TEXT NOT NULL DEFAULT 'primary'
);

CREATE OR REPLACE FUNCTION public.can_actor_manage_daily_allocation(target_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_id UUID := auth.uid();
  actor_team_id TEXT;
  target_team_id TEXT;
BEGIN
  IF actor_id IS NULL OR target_profile_id IS NULL THEN
    RETURN FALSE;
  END IF;
  IF public.effective_module_access_level('daily-allocation') >= 5 THEN
    RETURN TRUE;
  END IF;
  IF NOT public.effective_has_module_level('daily-allocation', 4) THEN
    RETURN FALSE;
  END IF;
  SELECT team_id INTO actor_team_id FROM public.profiles WHERE id = actor_id;
  SELECT team_id INTO target_team_id FROM public.profiles WHERE id = target_profile_id;
  IF actor_team_id IS NOT NULL AND target_team_id IS NOT NULL AND actor_team_id = target_team_id THEN
    RETURN TRUE;
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM public.profile_reporting_lines lines
    WHERE lines.profile_id = target_profile_id
      AND lines.manager_profile_id = actor_id
      AND lines.valid_from <= NOW()
      AND lines.valid_to IS NULL
      AND lines.relation_type IN ('primary', 'secondary')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.can_actor_manage_daily_allocation_team(target_team_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_id UUID := auth.uid();
  actor_team_id TEXT;
BEGIN
  IF actor_id IS NULL THEN
    RETURN FALSE;
  END IF;
  IF public.effective_module_access_level('daily-allocation') >= 5 THEN
    RETURN TRUE;
  END IF;
  IF NOT public.effective_has_module_level('daily-allocation', 4) THEN
    RETURN FALSE;
  END IF;
  SELECT team_id INTO actor_team_id FROM public.profiles WHERE id = actor_id;
  RETURN actor_team_id IS NOT NULL AND target_team_id IS NOT NULL AND actor_team_id = target_team_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_actor_view_daily_allocation(target_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND (
      target_profile_id = auth.uid()
      AND public.effective_has_module_level('daily-allocation', 2)
      OR public.can_actor_manage_daily_allocation(target_profile_id)
    );
$$;

CREATE OR REPLACE FUNCTION private.is_hidden_daily_allocation_profile(
  p_employee_id TEXT,
  p_full_name TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    COALESCE(p_employee_id, '') IN ('TS-ADM', 'TS-MGR', 'TS-EMP')
    OR (
      LOWER(BTRIM(COALESCE(p_full_name, ''))) = 'manager user'
      AND UPPER(BTRIM(COALESCE(p_employee_id, ''))) = 'MGR001'
    );
$$;

CREATE OR REPLACE FUNCTION private.allocation_site_is_valid(p_site TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    p_site IS NOT NULL
    AND LENGTH(BTRIM(regexp_replace(p_site, '\s+', ' ', 'g'))) >= 8;
$$;

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

CREATE TABLE IF NOT EXISTS public.quotes (
  id UUID PRIMARY KEY,
  quote_thread_id UUID,
  quote_number TEXT,
  site_address TEXT,
  customer_name TEXT,
  title TEXT
);

CREATE TABLE IF NOT EXISTS public.legacy_quotes (
  id UUID PRIMARY KEY,
  quote_number TEXT,
  site_address TEXT,
  customer_name TEXT,
  title TEXT
);

CREATE TABLE IF NOT EXISTS public.quote_project_numbers (
  id UUID PRIMARY KEY,
  project_reference TEXT NOT NULL,
  site_address TEXT,
  customer_name TEXT,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  converted_quote_id UUID,
  merged_into_project_number_id UUID
);

CREATE TABLE IF NOT EXISTS public.quote_reference_aliases (
  alias_reference TEXT PRIMARY KEY,
  canonical_quote_thread_id UUID
);

CREATE OR REPLACE FUNCTION private.apply_allocation_job_fields(
  p_source_type TEXT,
  p_source_id UUID,
  p_job_code TEXT,
  p_require_valid BOOLEAN
)
RETURNS private.allocation_job
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row private.allocation_job;
BEGIN
  IF p_source_type = 'live_quote' THEN
    SELECT
      'live_quote',
      quotes.id,
      COALESCE(NULLIF(BTRIM(p_job_code), ''), quotes.quote_number),
      quotes.site_address,
      quotes.customer_name,
      quotes.title,
      private.allocation_site_is_valid(quotes.site_address)
    INTO v_row
    FROM public.quotes
    WHERE quotes.id = p_source_id;
  ELSIF p_source_type = 'legacy_quote' THEN
    SELECT
      'legacy_quote',
      quotes.id,
      COALESCE(NULLIF(BTRIM(p_job_code), ''), quotes.quote_number),
      quotes.site_address,
      quotes.customer_name,
      quotes.title,
      private.allocation_site_is_valid(quotes.site_address)
    INTO v_row
    FROM public.legacy_quotes quotes
    WHERE quotes.id = p_source_id;
  ELSIF p_source_type = 'project_number' THEN
    SELECT
      'project_number',
      projects.id,
      COALESCE(NULLIF(BTRIM(p_job_code), ''), projects.project_reference),
      projects.site_address,
      projects.customer_name,
      projects.title,
      private.allocation_site_is_valid(projects.site_address)
    INTO v_row
    FROM public.quote_project_numbers projects
    WHERE projects.id = p_source_id;
  END IF;

  IF v_row.source_id IS NULL THEN
    IF p_require_valid THEN
      RAISE EXCEPTION 'JOB_NOT_FOUND';
    END IF;
    RETURN NULL;
  END IF;
  IF p_require_valid AND NOT v_row.address_valid THEN
    RAISE EXCEPTION 'JOB_MISSING_SITE';
  END IF;
  RETURN v_row;
END;
$$;

CREATE TABLE IF NOT EXISTS public.absence_reasons (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  is_paid BOOLEAN NOT NULL DEFAULT TRUE,
  allocation_behaviour TEXT NOT NULL DEFAULT 'block'
    CHECK (allocation_behaviour IN ('block', 'reduce', 'ignore'))
);

CREATE TABLE IF NOT EXISTS public.absences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id),
  reason_id UUID NOT NULL REFERENCES public.absence_reasons(id),
  date DATE NOT NULL,
  end_date DATE,
  is_half_day BOOLEAN NOT NULL DEFAULT FALSE,
  half_day_session TEXT,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.absences
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS public.employee_work_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id),
  monday_am BOOLEAN NOT NULL DEFAULT TRUE,
  monday_pm BOOLEAN NOT NULL DEFAULT TRUE,
  tuesday_am BOOLEAN NOT NULL DEFAULT TRUE,
  tuesday_pm BOOLEAN NOT NULL DEFAULT TRUE,
  wednesday_am BOOLEAN NOT NULL DEFAULT TRUE,
  wednesday_pm BOOLEAN NOT NULL DEFAULT TRUE,
  thursday_am BOOLEAN NOT NULL DEFAULT TRUE,
  thursday_pm BOOLEAN NOT NULL DEFAULT TRUE,
  friday_am BOOLEAN NOT NULL DEFAULT TRUE,
  friday_pm BOOLEAN NOT NULL DEFAULT TRUE,
  saturday_am BOOLEAN NOT NULL DEFAULT FALSE,
  saturday_pm BOOLEAN NOT NULL DEFAULT FALSE,
  sunday_am BOOLEAN NOT NULL DEFAULT FALSE,
  sunday_pm BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.employee_work_shifts
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.employee_work_shifts
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS public.plant (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  owner_team_id TEXT REFERENCES public.org_teams(id)
);

CREATE TABLE IF NOT EXISTS public.daily_labour_allocation_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_date DATE NOT NULL,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  job_source_type TEXT,
  job_source_id UUID,
  job_code TEXT,
  site_address TEXT,
  start_time TEXT,
  meeting_point TEXT,
  meet_person TEXT,
  notes TEXT,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT daily_labour_allocation_drafts_unique_profile_date UNIQUE (work_date, profile_id)
);

CREATE TABLE IF NOT EXISTS public.daily_plant_allocation_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_date DATE NOT NULL,
  plant_kind TEXT NOT NULL,
  plant_id UUID REFERENCES public.plant(id) ON DELETE CASCADE,
  hired_serial TEXT,
  hired_description TEXT,
  hired_company TEXT,
  hired_serial_normalized TEXT GENERATED ALWAYS AS (
    NULLIF(UPPER(BTRIM(regexp_replace(COALESCE(hired_serial, ''), '\s+', ' ', 'g'))), '')
  ) STORED,
  hired_company_normalized TEXT GENERATED ALWAYS AS (
    NULLIF(UPPER(BTRIM(regexp_replace(COALESCE(hired_company, ''), '\s+', ' ', 'g'))), '')
  ) STORED,
  owner_team_id TEXT REFERENCES public.org_teams(id) ON DELETE SET NULL,
  job_source_type TEXT,
  job_source_id UUID,
  job_code TEXT,
  site_address TEXT,
  notes TEXT,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.daily_allocation_publications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_date DATE NOT NULL,
  revision_no INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  published_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scope_team_id TEXT REFERENCES public.org_teams(id) ON DELETE SET NULL,
  scope_profile_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT daily_allocation_publications_revision_unique UNIQUE (work_date, revision_no),
  CONSTRAINT daily_allocation_publications_idempotency_unique UNIQUE (idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.daily_allocation_labour_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id UUID NOT NULL REFERENCES public.daily_allocation_publications(id) ON DELETE RESTRICT,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  availability TEXT NOT NULL,
  job_source_type TEXT,
  job_source_id UUID,
  job_code TEXT,
  site_address TEXT,
  customer_name TEXT,
  title TEXT,
  start_time TEXT,
  meeting_point TEXT,
  meet_person TEXT,
  notes TEXT,
  absence_id UUID,
  absence_reason_id UUID,
  absence_reason_name TEXT,
  absence_colour TEXT,
  absence_is_paid BOOLEAN,
  absence_is_half_day BOOLEAN,
  absence_half_day_session TEXT,
  absence_status TEXT,
  absence_allocation_behaviour TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT daily_allocation_labour_items_unique UNIQUE (publication_id, profile_id)
);

CREATE TABLE IF NOT EXISTS public.daily_allocation_plant_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id UUID NOT NULL REFERENCES public.daily_allocation_publications(id) ON DELETE RESTRICT,
  plant_kind TEXT NOT NULL,
  plant_id UUID REFERENCES public.plant(id) ON DELETE RESTRICT,
  hired_serial TEXT,
  hired_description TEXT,
  hired_company TEXT,
  hired_serial_normalized TEXT,
  hired_company_normalized TEXT,
  owner_team_id TEXT,
  job_source_type TEXT,
  job_source_id UUID,
  job_code TEXT NOT NULL,
  site_address TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  priority TEXT NOT NULL,
  sender_id UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_via TEXT,
  module_key TEXT,
  daily_allocation_labour_item_id UUID REFERENCES public.daily_allocation_labour_items(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.message_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id),
  status TEXT NOT NULL DEFAULT 'PENDING'
);

CREATE OR REPLACE FUNCTION private.guard_daily_allocation_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'Published daily allocation records cannot be changed';
END;
$$;

CREATE OR REPLACE FUNCTION private.prepare_daily_allocation_publication()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.finish_daily_allocation_publication()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.guard_daily_labour_allocation_draft_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION private.guard_daily_plant_allocation_draft_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION private.guard_daily_allocation_message_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION private.guard_daily_allocation_recipient_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS daily_allocation_publications_prepare ON public.daily_allocation_publications;
CREATE TRIGGER daily_allocation_publications_prepare
  BEFORE INSERT ON public.daily_allocation_publications
  FOR EACH ROW
  EXECUTE FUNCTION private.prepare_daily_allocation_publication();

DROP TRIGGER IF EXISTS daily_allocation_publications_finish ON public.daily_allocation_publications;
CREATE TRIGGER daily_allocation_publications_finish
  AFTER INSERT ON public.daily_allocation_publications
  FOR EACH ROW
  EXECUTE FUNCTION private.finish_daily_allocation_publication();

DROP TRIGGER IF EXISTS daily_allocation_publications_immutable ON public.daily_allocation_publications;
CREATE TRIGGER daily_allocation_publications_immutable
  BEFORE UPDATE OR DELETE ON public.daily_allocation_publications
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_daily_allocation_immutable();

DROP TRIGGER IF EXISTS daily_allocation_labour_items_immutable ON public.daily_allocation_labour_items;
CREATE TRIGGER daily_allocation_labour_items_immutable
  BEFORE UPDATE OR DELETE ON public.daily_allocation_labour_items
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_daily_allocation_immutable();

DROP TRIGGER IF EXISTS daily_allocation_plant_items_immutable ON public.daily_allocation_plant_items;
CREATE TRIGGER daily_allocation_plant_items_immutable
  BEFORE UPDATE OR DELETE ON public.daily_allocation_plant_items
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_daily_allocation_immutable();

DROP TRIGGER IF EXISTS daily_labour_allocation_drafts_guard ON public.daily_labour_allocation_drafts;
CREATE TRIGGER daily_labour_allocation_drafts_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.daily_labour_allocation_drafts
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_daily_labour_allocation_draft_write();

DROP TRIGGER IF EXISTS daily_plant_allocation_drafts_guard ON public.daily_plant_allocation_drafts;
CREATE TRIGGER daily_plant_allocation_drafts_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.daily_plant_allocation_drafts
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_daily_plant_allocation_draft_write();

DROP TRIGGER IF EXISTS messages_daily_allocation_guard ON public.messages;
CREATE TRIGGER messages_daily_allocation_guard
  BEFORE UPDATE OR DELETE ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_daily_allocation_message_mutation();

DROP TRIGGER IF EXISTS message_recipients_daily_allocation_guard ON public.message_recipients;
CREATE TRIGGER message_recipients_daily_allocation_guard
  BEFORE UPDATE OR DELETE ON public.message_recipients
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_daily_allocation_recipient_mutation();

ALTER TABLE public.daily_labour_allocation_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_plant_allocation_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_allocation_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_allocation_labour_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_allocation_plant_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_labour_allocation_drafts_write ON public.daily_labour_allocation_drafts;
CREATE POLICY daily_labour_allocation_drafts_write ON public.daily_labour_allocation_drafts
  FOR ALL TO authenticated
  USING (public.can_actor_manage_daily_allocation(profile_id))
  WITH CHECK (public.can_actor_manage_daily_allocation(profile_id));

DROP POLICY IF EXISTS daily_allocation_publications_insert ON public.daily_allocation_publications;
CREATE POLICY daily_allocation_publications_insert ON public.daily_allocation_publications
  FOR INSERT TO authenticated
  WITH CHECK (public.effective_has_module_level('daily-allocation', 4));

DROP POLICY IF EXISTS daily_allocation_publications_select ON public.daily_allocation_publications;
CREATE POLICY daily_allocation_publications_select ON public.daily_allocation_publications
  FOR SELECT TO authenticated
  USING (published_by = auth.uid() OR auth.uid() = ANY (scope_profile_ids));

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.daily_labour_allocation_drafts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.daily_plant_allocation_drafts TO authenticated;
GRANT SELECT, INSERT ON TABLE public.daily_allocation_publications TO authenticated;
GRANT SELECT ON TABLE public.daily_allocation_labour_items TO authenticated;
GRANT SELECT ON TABLE public.daily_allocation_plant_items TO authenticated;
GRANT SELECT ON TABLE public.profiles TO authenticated;
GRANT SELECT ON TABLE public.org_teams TO authenticated;
GRANT SELECT ON TABLE public.quote_project_numbers TO authenticated;
GRANT SELECT ON TABLE public.quotes TO authenticated;
GRANT SELECT ON TABLE public.legacy_quotes TO authenticated;
GRANT SELECT ON TABLE public.plant TO authenticated;
GRANT SELECT ON TABLE public.absences TO authenticated;
GRANT SELECT ON TABLE public.absence_reasons TO authenticated;
GRANT SELECT ON TABLE public.employee_work_shifts TO authenticated;
GRANT SELECT ON TABLE public.messages TO authenticated;
GRANT SELECT ON TABLE public.message_recipients TO authenticated;

GRANT EXECUTE ON FUNCTION public.effective_has_module_level(TEXT, INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.effective_module_access_level(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_actor_manage_daily_allocation(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_actor_manage_daily_allocation_team(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_actor_view_daily_allocation(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.view_as_role_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

INSERT INTO public.org_teams (id, name) VALUES ('team-1', 'Civils')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, full_name, employee_id, team_id, is_placeholder) VALUES
  ('11111111-1111-4111-8111-111111111111', 'Manager One', 'MGR100', 'team-1', FALSE),
  ('22222222-2222-4222-8222-222222222222', 'Alex Worker', 'E001', 'team-1', FALSE),
  ('33333333-3333-4333-8333-333333333333', 'Blair Worker', 'E002', 'team-1', FALSE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO private.test_actor_module_level (profile_id, daily_allocation_level) VALUES
  ('11111111-1111-4111-8111-111111111111', 4),
  ('22222222-2222-4222-8222-222222222222', 2),
  ('33333333-3333-4333-8333-333333333333', 2)
ON CONFLICT (profile_id) DO NOTHING;

INSERT INTO public.quote_project_numbers (id, project_reference, site_address, customer_name, title, status) VALUES
  ('44444444-4444-4444-8444-444444444444', '60001-MD', '12 Site Road, Town', 'Acme', 'Main works', 'active'),
  ('55555555-5555-4555-8555-555555555555', '60002-MD', '18 Other Road, Town', 'Acme', 'Second works', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.plant (id, name, owner_team_id) VALUES
  ('66666666-6666-4666-8666-666666666666', 'Excavator 1', 'team-1')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.absence_reasons (id, name, color, is_paid, allocation_behaviour) VALUES
  ('77777777-7777-4777-8777-777777777777', 'Holiday', '#00aa00', TRUE, 'block')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.daily_labour_allocation_drafts (
  id, work_date, profile_id, job_source_type, job_source_id, job_code, site_address, start_time
) VALUES (
  '88888888-8888-4888-8888-888888888888',
  '2026-08-10',
  '22222222-2222-4222-8222-222222222222',
  'project_number',
  '44444444-4444-4444-8444-444444444444',
  '60001-MD',
  '12 Site Road, Town',
  '08:00'
) ON CONFLICT DO NOTHING;

INSERT INTO public.daily_plant_allocation_drafts (
  id, work_date, plant_kind, plant_id, owner_team_id, job_source_type, job_source_id, job_code, site_address
) VALUES (
  '99999999-9999-4999-8999-999999999999',
  '2026-08-10',
  'registered',
  '66666666-6666-4666-8666-666666666666',
  'team-1',
  'project_number',
  '44444444-4444-4444-8444-444444444444',
  '60001-MD',
  '12 Site Road, Town'
) ON CONFLICT DO NOTHING;
