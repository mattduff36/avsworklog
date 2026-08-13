-- Controlled Daily Allocation v2 activation.
-- Do not run from application startup, CI, or the additive migration.
-- Apply only after explicit operator validation that:
--   1. 20260813_zzz_daily_allocation_v2_visit_model.sql is applied
--   2. v1 publication/draft row counts and hashes are unchanged
--   3. isolated runtime proofs for RLS, publish, grid, and plant claims passed
-- Idempotent: re-running leaves both flags TRUE.

BEGIN;

DO $$
BEGIN
  IF to_regclass('private.daily_allocation_v2_runtime') IS NULL
    OR to_regclass('public.daily_allocation_visits') IS NULL
    OR to_regprocedure('public.publish_daily_allocation_plan_v2(uuid,integer,text,boolean)') IS NULL
    OR to_regprocedure('public.move_daily_allocation_visit_v2(uuid,uuid,integer,integer,integer,timestamptz,timestamptz)') IS NULL
  THEN
    RAISE EXCEPTION 'Daily allocation v2 activation validation failed: required objects are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM private.daily_allocation_v2_runtime runtime
    WHERE runtime.singleton = TRUE
  ) THEN
    RAISE EXCEPTION 'Daily allocation v2 activation validation failed: runtime gate row is missing';
  END IF;
END;
$$;

UPDATE private.daily_allocation_v2_runtime
SET
  board_enabled = TRUE,
  writes_enabled = TRUE,
  updated_at = NOW()
WHERE singleton = TRUE
  AND (board_enabled IS DISTINCT FROM TRUE OR writes_enabled IS DISTINCT FROM TRUE);

UPDATE private.daily_allocation_v2_runtime
SET updated_at = NOW()
WHERE singleton = TRUE
  AND board_enabled = TRUE
  AND writes_enabled = TRUE;

COMMIT;
