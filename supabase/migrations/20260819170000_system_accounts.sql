BEGIN;

ALTER TABLE public.org_teams
  ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_system_account BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_profiles_is_system_account
  ON public.profiles (id)
  WHERE is_system_account = TRUE;

CREATE TABLE IF NOT EXISTS private.system_account_migration_snapshots (
  snapshot_key TEXT PRIMARY KEY,
  kiosk_user_id UUID NOT NULL,
  profile_before JSONB NOT NULL,
  team_before JSONB,
  team_permissions_before JSONB,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS private.system_account_absence_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_key TEXT NOT NULL REFERENCES private.system_account_migration_snapshots(snapshot_key) ON DELETE CASCADE,
  source_table TEXT NOT NULL CHECK (source_table IN ('absences', 'absences_archive')),
  absence_id UUID NOT NULL,
  row_data JSONB NOT NULL
);

REVOKE ALL ON TABLE private.system_account_migration_snapshots FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE private.system_account_absence_snapshots FROM PUBLIC, anon, authenticated;

ALTER TABLE private.system_account_migration_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.system_account_absence_snapshots ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.protect_system_account_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(current_setting('app.system_account_maintenance', true), '') = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system_account THEN
      RAISE EXCEPTION 'System accounts cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.is_system_account THEN
      RAISE EXCEPTION 'System accounts cannot be created from the application';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.is_system_account IS DISTINCT FROM OLD.is_system_account THEN
    RAISE EXCEPTION 'System account identity cannot be changed';
  END IF;

  IF OLD.is_system_account THEN
    IF NEW.team_id IS DISTINCT FROM OLD.team_id THEN
      RAISE EXCEPTION 'System account team cannot be changed';
    END IF;
    IF NEW.annual_holiday_allowance_days IS DISTINCT FROM OLD.annual_holiday_allowance_days THEN
      RAISE EXCEPTION 'System account holiday allowance cannot be changed';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_system_account_identity ON public.profiles;
CREATE TRIGGER trg_protect_system_account_identity
  BEFORE INSERT OR UPDATE OR DELETE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION private.protect_system_account_identity();

CREATE OR REPLACE FUNCTION private.protect_system_team()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(current_setting('app.system_account_maintenance', true), '') = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system OR OLD.id = 'system_accounts' THEN
      RAISE EXCEPTION 'System Accounts team cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.is_system OR NEW.id = 'system_accounts' THEN
      RAISE EXCEPTION 'System teams cannot be created from the application';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.is_system OR OLD.id = 'system_accounts' OR NEW.is_system IS DISTINCT FROM OLD.is_system THEN
    RAISE EXCEPTION 'System Accounts team cannot be changed';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_system_team ON public.org_teams;
CREATE TRIGGER trg_protect_system_team
  BEFORE INSERT OR UPDATE OR DELETE ON public.org_teams
  FOR EACH ROW
  EXECUTE FUNCTION private.protect_system_team();

CREATE OR REPLACE FUNCTION private.protect_system_team_permissions()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_is_system BOOLEAN := FALSE;
  v_new_is_system BOOLEAN := FALSE;
BEGIN
  IF COALESCE(current_setting('app.system_account_maintenance', true), '') = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.org_teams
      WHERE id = OLD.team_id
        AND (is_system = TRUE OR id = 'system_accounts')
    )
    INTO v_old_is_system;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.org_teams
      WHERE id = NEW.team_id
        AND (is_system = TRUE OR id = 'system_accounts')
    )
    INTO v_new_is_system;
  END IF;

  IF NOT v_old_is_system AND NOT v_new_is_system THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'System Accounts team defaults cannot be removed';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.team_id IS DISTINCT FROM OLD.team_id THEN
    RAISE EXCEPTION 'System Accounts team defaults cannot be moved';
  END IF;

  IF COALESCE(NEW.enabled, FALSE) THEN
    RAISE EXCEPTION 'System Accounts team defaults cannot be enabled';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_system_team_permissions ON public.team_module_permissions;
CREATE TRIGGER trg_protect_system_team_permissions
  BEFORE INSERT OR UPDATE OR DELETE ON public.team_module_permissions
  FOR EACH ROW
  EXECUTE FUNCTION private.protect_system_team_permissions();

CREATE OR REPLACE FUNCTION private.filter_daily_allocation_scope_ids(p_ids UUID[])
RETURNS UUID[]
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    ARRAY_AGG(profiles.id ORDER BY profiles.full_name, profiles.id),
    ARRAY[]::UUID[]
  )
  FROM unnest(COALESCE(p_ids, ARRAY[]::UUID[])) AS requested(id)
  JOIN public.profiles ON profiles.id = requested.id
  WHERE COALESCE(profiles.is_placeholder, FALSE) = FALSE
    AND COALESCE(profiles.is_system_account, FALSE) = FALSE
    AND NOT private.is_hidden_daily_allocation_profile(profiles.employee_id, profiles.full_name);
$$;

CREATE OR REPLACE FUNCTION private.guard_daily_allocation_publication_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.scope_profile_ids := private.filter_daily_allocation_scope_ids(NEW.scope_profile_ids);
  IF COALESCE(NEW.snapshot_version, 1) <> 2 THEN
    IF NEW.scope_profile_ids IS NULL OR ARRAY_LENGTH(NEW.scope_profile_ids, 1) IS NULL THEN
      RAISE EXCEPTION 'No employees are in scope for this publication';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_filter_daily_allocation_publication_scope
  ON public.daily_allocation_publications;
CREATE TRIGGER trg_filter_daily_allocation_publication_scope
  BEFORE INSERT ON public.daily_allocation_publications
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_daily_allocation_publication_scope();

CREATE OR REPLACE FUNCTION private.reject_system_account_labour_allocation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  target_id UUID;
BEGIN
  target_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.profile_id ELSE NEW.profile_id END;
  IF EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = target_id
      AND COALESCE(is_system_account, FALSE) = TRUE
  ) THEN
    RAISE EXCEPTION 'Not allowed to change this labour allocation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reject_system_account_labour_draft
  ON public.daily_labour_allocation_drafts;
CREATE TRIGGER trg_reject_system_account_labour_draft
  BEFORE INSERT OR UPDATE OR DELETE ON public.daily_labour_allocation_drafts
  FOR EACH ROW
  EXECUTE FUNCTION private.reject_system_account_labour_allocation();

DO $$
BEGIN
  IF to_regclass('public.daily_allocation_visit_labour') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_reject_system_account_visit_labour
      ON public.daily_allocation_visit_labour;
    CREATE TRIGGER trg_reject_system_account_visit_labour
      BEFORE INSERT OR UPDATE OR DELETE ON public.daily_allocation_visit_labour
      FOR EACH ROW
      EXECUTE FUNCTION private.reject_system_account_labour_allocation();
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_daily_allocation_scope_profile_ids()
RETURNS UUID[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    ARRAY_AGG(profiles.id ORDER BY profiles.full_name, profiles.id),
    ARRAY[]::UUID[]
  )
  FROM public.profiles
  WHERE COALESCE(profiles.is_placeholder, FALSE) = FALSE
    AND COALESCE(profiles.is_system_account, FALSE) = FALSE
    AND NOT private.is_hidden_daily_allocation_profile(profiles.employee_id, profiles.full_name)
    AND public.can_actor_manage_daily_allocation(profiles.id);
$$;

REVOKE ALL ON FUNCTION public.list_daily_allocation_scope_profile_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_daily_allocation_scope_profile_ids() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.close_absence_financial_year_bookings(
  p_financial_year_start_year INTEGER,
  p_actor_profile_id UUID DEFAULT auth.uid(),
  p_notes TEXT DEFAULT NULL
)
RETURNS TABLE (
  financial_year_start_year INTEGER,
  pending_count INTEGER,
  carryovers_written INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_authenticated_profile_id UUID;
  v_start_date DATE;
  v_end_date DATE;
  v_pending_count INTEGER;
  v_carryovers_written INTEGER := 0;
  v_profile_id UUID;
  v_carryover_days NUMERIC;
BEGIN
  v_authenticated_profile_id := auth.uid();
  IF v_authenticated_profile_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  IF NOT effective_is_manager_admin() THEN
    RAISE EXCEPTION 'Only managers or admins can close a financial year.';
  END IF;

  IF p_actor_profile_id IS DISTINCT FROM v_authenticated_profile_id THEN
    RAISE EXCEPTION 'Actor profile mismatch for close-year operation.';
  END IF;

  v_start_date := make_date(p_financial_year_start_year, 4, 1);
  v_end_date := make_date(p_financial_year_start_year + 1, 3, 31);

  SELECT COUNT(*)::INTEGER
  INTO v_pending_count
  FROM absences a
  WHERE a.status = 'pending'
    AND a.date <= v_end_date
    AND COALESCE(a.end_date, a.date) >= v_start_date;

  IF v_pending_count > 0 THEN
    RAISE EXCEPTION 'Current year still has pending bookings. Accept or decline these first.';
  END IF;

  PERFORM snapshot_financial_year_carryovers_before_close(
    p_financial_year_start_year,
    p_actor_profile_id
  );

  INSERT INTO absence_financial_year_closures (
    financial_year_start_year,
    closed_at,
    closed_by,
    notes
  )
  VALUES (
    p_financial_year_start_year,
    NOW(),
    p_actor_profile_id,
    p_notes
  )
  ON CONFLICT ON CONSTRAINT absence_financial_year_closures_financial_year_start_year_key
  DO UPDATE SET
    closed_at = EXCLUDED.closed_at,
    closed_by = EXCLUDED.closed_by,
    notes = EXCLUDED.notes,
    updated_at = NOW();

  FOR v_profile_id IN
    SELECT p.id
    FROM profiles p
    WHERE COALESCE(p.full_name, '') NOT ILIKE '%(Deleted User)%'
      AND COALESCE(p.is_system_account, FALSE) = FALSE
    ORDER BY p.id
  LOOP
    v_carryover_days := recalculate_financial_year_carryover_for_profile(
      p_financial_year_start_year,
      v_profile_id,
      p_actor_profile_id
    );
    IF v_carryover_days <> 0 THEN
      v_carryovers_written := v_carryovers_written + 1;
    END IF;
  END LOOP;

  RETURN QUERY
  SELECT
    p_financial_year_start_year,
    v_pending_count,
    v_carryovers_written;
END;
$$;

REVOKE ALL ON FUNCTION public.close_absence_financial_year_bookings(INTEGER, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_absence_financial_year_bookings(INTEGER, UUID, TEXT) TO authenticated;

SELECT set_config('app.system_account_maintenance', 'on', true);
SELECT set_config('app.absence_historic_delete_bypass', 'on', true);

DO $$
DECLARE
  v_kiosk_id UUID;
  v_snapshot_key TEXT := 'yard-kiosk-system-accounts-v1';
  v_profile_before JSONB;
  v_team_before JSONB;
  v_team_permissions_before JSONB;
BEGIN
  SELECT to_jsonb(org_teams.*)
  INTO v_team_before
  FROM public.org_teams
  WHERE id = 'system_accounts';

  SELECT COALESCE(jsonb_agg(to_jsonb(team_module_permissions.*) ORDER BY module_name), '[]'::JSONB)
  INTO v_team_permissions_before
  FROM public.team_module_permissions
  WHERE team_id = 'system_accounts';

  SELECT kiosk_user_id
  INTO v_kiosk_id
  FROM public.inventory_kiosk_config
  WHERE id = 1
  FOR UPDATE;

  IF v_kiosk_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.absence_allowance_carryovers
      WHERE profile_id = v_kiosk_id
    ) THEN
      RAISE EXCEPTION 'Configured kiosk has leave carryover; refusing system-account migration';
    END IF;

    PERFORM 1 FROM public.profiles WHERE id = v_kiosk_id FOR UPDATE;
    PERFORM 1
    FROM public.absences
    WHERE profile_id = v_kiosk_id
      AND is_bank_holiday IS TRUE
    FOR UPDATE;
    PERFORM 1
    FROM public.absences_archive
    WHERE profile_id = v_kiosk_id
      AND is_bank_holiday IS TRUE
    FOR UPDATE;

    SELECT to_jsonb(profiles.*)
    INTO v_profile_before
    FROM public.profiles
    WHERE id = v_kiosk_id;

    IF v_profile_before IS NULL THEN
      RAISE EXCEPTION 'Configured kiosk profile was not found';
    END IF;

    INSERT INTO private.system_account_migration_snapshots (
      snapshot_key,
      kiosk_user_id,
      profile_before,
      team_before,
      team_permissions_before
    )
    VALUES (
      v_snapshot_key,
      v_kiosk_id,
      v_profile_before,
      v_team_before,
      v_team_permissions_before
    )
    ON CONFLICT (snapshot_key) DO NOTHING;

    INSERT INTO private.system_account_absence_snapshots (
      snapshot_key,
      source_table,
      absence_id,
      row_data
    )
    SELECT v_snapshot_key, 'absences', absences.id, to_jsonb(absences.*)
    FROM public.absences
    WHERE absences.profile_id = v_kiosk_id
      AND absences.is_bank_holiday IS TRUE
      AND NOT EXISTS (
        SELECT 1
        FROM private.system_account_absence_snapshots AS existing
        WHERE existing.snapshot_key = v_snapshot_key
          AND existing.source_table = 'absences'
          AND existing.absence_id = absences.id
      )
    UNION ALL
    SELECT v_snapshot_key, 'absences_archive', absences_archive.id, to_jsonb(absences_archive.*)
    FROM public.absences_archive
    WHERE absences_archive.profile_id = v_kiosk_id
      AND absences_archive.is_bank_holiday IS TRUE
      AND NOT EXISTS (
        SELECT 1
        FROM private.system_account_absence_snapshots AS existing
        WHERE existing.snapshot_key = v_snapshot_key
          AND existing.source_table = 'absences_archive'
          AND existing.absence_id = absences_archive.id
      );
  END IF;

  INSERT INTO public.org_teams (
    id,
    name,
    code,
    active,
    is_system,
    timesheet_type,
    manager_1_profile_id,
    manager_2_profile_id
  )
  VALUES (
    'system_accounts',
    'System Accounts',
    'system',
    TRUE,
    TRUE,
    NULL,
    NULL,
    NULL
  )
  ON CONFLICT (id) DO UPDATE
  SET
    name = EXCLUDED.name,
    code = EXCLUDED.code,
    active = TRUE,
    is_system = TRUE,
    timesheet_type = NULL,
    manager_1_profile_id = NULL,
    manager_2_profile_id = NULL;

  INSERT INTO public.team_module_permissions (team_id, module_name, enabled, updated_at)
  SELECT
    'system_accounts',
    permission_modules.module_name,
    FALSE,
    NOW()
  FROM public.permission_modules
  ON CONFLICT (team_id, module_name) DO UPDATE
  SET
    enabled = FALSE,
    updated_at = NOW();

  IF v_kiosk_id IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM public.absences
  WHERE id IN (
    SELECT absence_id
    FROM private.system_account_absence_snapshots
    WHERE snapshot_key = v_snapshot_key
      AND source_table = 'absences'
  );

  DELETE FROM public.absences_archive
  WHERE id IN (
    SELECT absence_id
    FROM private.system_account_absence_snapshots
    WHERE snapshot_key = v_snapshot_key
      AND source_table = 'absences_archive'
  );

  UPDATE public.profiles
  SET
    team_id = 'system_accounts',
    is_system_account = TRUE,
    annual_holiday_allowance_days = 0
  WHERE id = v_kiosk_id;
END;
$$;

COMMIT;
