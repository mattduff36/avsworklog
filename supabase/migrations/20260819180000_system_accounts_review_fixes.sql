BEGIN;

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

UPDATE private.system_account_migration_snapshots
SET
  team_before = NULL,
  team_permissions_before = '[]'::JSONB
WHERE snapshot_key = 'yard-kiosk-system-accounts-v1'
  AND team_before IS NOT NULL
  AND team_before->>'id' = 'system_accounts';

COMMIT;
