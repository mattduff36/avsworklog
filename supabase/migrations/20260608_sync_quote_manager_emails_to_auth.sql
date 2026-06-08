-- Keep quote manager email routing aligned with the manager's Supabase auth email.
-- This prevents quote CC/PDF contact emails from drifting away from the login/reply-to email.

DO $$
DECLARE
  updated_manager_defaults integer := 0;
  updated_quotes integer := 0;
BEGIN
  WITH manager_auth_emails AS (
    SELECT
      qms.profile_id,
      btrim(au.email) AS auth_email
    FROM public.quote_manager_series qms
    JOIN auth.users au ON au.id = qms.profile_id
    WHERE btrim(coalesce(au.email, '')) <> ''
  )
  UPDATE public.quote_manager_series qms
  SET manager_email = mae.auth_email
  FROM manager_auth_emails mae
  WHERE qms.profile_id = mae.profile_id
    AND qms.manager_email IS DISTINCT FROM mae.auth_email;

  GET DIAGNOSTICS updated_manager_defaults = ROW_COUNT;

  WITH manager_auth_emails AS (
    SELECT
      qms.profile_id,
      btrim(au.email) AS auth_email
    FROM public.quote_manager_series qms
    JOIN auth.users au ON au.id = qms.profile_id
    WHERE btrim(coalesce(au.email, '')) <> ''
  )
  UPDATE public.quotes q
  SET manager_email = mae.auth_email
  FROM manager_auth_emails mae
  WHERE q.requester_id = mae.profile_id
    AND q.manager_email IS DISTINCT FROM mae.auth_email;

  GET DIAGNOSTICS updated_quotes = ROW_COUNT;

  RAISE NOTICE 'Synced % quote manager default email(s) and % quote email value(s) to auth emails.',
    updated_manager_defaults,
    updated_quotes;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.quote_manager_series
    WHERE lower(manager_email) = 'louis@avsquires.co.uk'
  ) THEN
    RAISE EXCEPTION 'Louis old quote manager default email is still present.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.quotes
    WHERE lower(manager_email) = 'louis@avsquires.co.uk'
  ) THEN
    RAISE EXCEPTION 'Louis old stored quote manager email is still present.';
  END IF;
END $$;
