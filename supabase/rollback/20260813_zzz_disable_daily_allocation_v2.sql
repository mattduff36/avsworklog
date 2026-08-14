-- DA2-ROLL-001: disable-and-forward-fix for Daily Allocation v2.
-- Preserves v1 and v2 tables, publications, snapshots, messages, and plan days.
-- This path changes only the v2 runtime flags. It deliberately leaves the
-- configured team/user/role permission matrix untouched. It does not destroy
-- data, rewrite publication versions, infer end times, or reopen converted
-- team/date v1 writes.
BEGIN;

DO $$
DECLARE
  singleton_count INTEGER;
BEGIN
  IF to_regclass('private.daily_allocation_v2_runtime') IS NULL THEN
    RAISE EXCEPTION 'Daily allocation v2 disable failed: runtime table is missing';
  END IF;

  PERFORM 1
  FROM private.daily_allocation_v2_runtime
  WHERE singleton = TRUE
  FOR UPDATE;

  SELECT COUNT(*)::INTEGER
  INTO singleton_count
  FROM private.daily_allocation_v2_runtime;

  IF singleton_count <> 1
    OR NOT EXISTS (
      SELECT 1
      FROM private.daily_allocation_v2_runtime
      WHERE singleton = TRUE
    )
  THEN
    RAISE EXCEPTION 'Daily allocation v2 disable failed: expected exactly one runtime singleton';
  END IF;
END;
$$;

UPDATE private.daily_allocation_v2_runtime
SET board_enabled = FALSE,
    writes_enabled = FALSE,
    updated_at = NOW()
WHERE singleton = TRUE
  AND (board_enabled IS DISTINCT FROM FALSE OR writes_enabled IS DISTINCT FROM FALSE);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM private.daily_allocation_v2_runtime
    WHERE singleton = TRUE
      AND board_enabled = FALSE
      AND writes_enabled = FALSE
  ) THEN
    RAISE EXCEPTION 'Daily allocation v2 disable failed to reach closed state';
  END IF;
END;
$$;

COMMIT;
