-- Isolated job-catalogue representative PGlite fixture. Do not apply to production.

DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

CREATE TABLE public.customers (
  id UUID PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active',
  company_name TEXT
);

CREATE TABLE public.quotes (
  id UUID PRIMARY KEY,
  quote_thread_id UUID NOT NULL,
  customer_id UUID NOT NULL REFERENCES public.customers(id),
  base_quote_reference TEXT,
  quote_reference TEXT,
  subject_line TEXT,
  project_description TEXT,
  site_address TEXT,
  status TEXT,
  commercial_status TEXT NOT NULL DEFAULT 'open',
  is_latest_version BOOLEAN NOT NULL DEFAULT FALSE,
  revision_number INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.quote_reference_aliases (
  alias_reference TEXT PRIMARY KEY,
  source_quote_thread_id UUID NOT NULL,
  canonical_quote_thread_id UUID NOT NULL
);

CREATE TABLE public.quote_project_numbers (
  id UUID PRIMARY KEY,
  project_reference TEXT NOT NULL,
  title TEXT,
  description TEXT,
  site_address TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  merged_into_project_number_id UUID,
  converted_quote_id UUID
);

CREATE TABLE public.legacy_quotes (
  id UUID PRIMARY KEY,
  quote_reference TEXT,
  customer_name TEXT,
  title TEXT,
  site_address TEXT
);

CREATE OR REPLACE FUNCTION private.allocation_site_is_valid(p_site TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    p_site IS NOT NULL
    AND LENGTH(BTRIM(regexp_replace(p_site, '\s+', ' ', 'g'))) >= 8
    AND (
      ARRAY_LENGTH(regexp_split_to_array(BTRIM(p_site), E'\n+'), 1) >= 2
      OR ARRAY_LENGTH(regexp_split_to_array(BTRIM(regexp_replace(p_site, '\s+', ' ', 'g')), ' '), 1) >= 3
    );
$$;

CREATE OR REPLACE FUNCTION private.allocation_quote_is_catalogue_eligible(
  p_is_latest BOOLEAN,
  p_commercial_status TEXT,
  p_status TEXT,
  p_customer_status TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    COALESCE(p_is_latest, FALSE)
    AND p_commercial_status = 'open'
    AND p_customer_status = 'active'
    AND p_status = ANY (ARRAY[
      'sent',
      'won',
      'ready_to_invoice',
      'po_received',
      'in_progress',
      'completed_part',
      'completed_full',
      'partially_invoiced',
      'invoiced'
    ]);
$$;
