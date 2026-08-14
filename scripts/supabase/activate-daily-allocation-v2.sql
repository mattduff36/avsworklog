-- Controlled Daily Allocation v2 activation.
-- Do not run from application startup, CI, or the additive migration.
-- Apply only through scripts/manage-daily-allocation-v2-rollout.ts after the
-- exact deployed commit, migration checksum, permission fingerprint, and v1
-- content fingerprint have been verified.
-- Idempotent: re-running leaves both flags TRUE.

BEGIN;

DO $$
DECLARE
  relation_name TEXT;
  relation_oid REGCLASS;
  procedure_signature TEXT;
  procedure_oid REGPROCEDURE;
  singleton_count INTEGER;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'private.daily_allocation_v2_runtime',
    'public.daily_allocation_plan_days',
    'public.daily_allocation_visits',
    'public.daily_allocation_visit_labour',
    'public.daily_allocation_visit_plant',
    'public.daily_allocation_conflict_overrides',
    'private.daily_allocation_plant_day_jobs',
    'public.daily_allocation_published_visits',
    'public.daily_allocation_published_labour',
    'public.daily_allocation_published_plant',
    'public.daily_allocation_published_overrides',
    'public.daily_allocation_publication_notifications'
  ]
  LOOP
    relation_oid := to_regclass(relation_name);
    IF relation_oid IS NULL THEN
      RAISE EXCEPTION 'Daily allocation v2 activation validation failed: missing relation %', relation_name;
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_class
      WHERE oid = relation_oid
        AND relkind IN ('r', 'p')
    ) THEN
      RAISE EXCEPTION 'Daily allocation v2 activation validation failed: unexpected relation type %', relation_name;
    END IF;
    IF split_part(relation_name, '.', 1) = 'public'
      AND (
        NOT EXISTS (
          SELECT 1
          FROM pg_class
          WHERE oid = relation_oid
            AND relrowsecurity = TRUE
        )
        OR NOT has_table_privilege('authenticated', relation_oid, 'SELECT')
      )
    THEN
      RAISE EXCEPTION 'Daily allocation v2 activation validation failed: public read/RLS contract failed %', relation_name;
    END IF;
    IF (
      has_table_privilege('authenticated', relation_oid, 'INSERT')
      OR has_table_privilege('authenticated', relation_oid, 'UPDATE')
      OR has_table_privilege('authenticated', relation_oid, 'DELETE')
      OR has_table_privilege('authenticated', relation_oid, 'TRUNCATE')
      OR has_table_privilege('authenticated', relation_oid, 'REFERENCES')
      OR has_table_privilege('authenticated', relation_oid, 'TRIGGER')
      OR has_any_column_privilege('authenticated', relation_oid, 'INSERT')
      OR has_any_column_privilege('authenticated', relation_oid, 'UPDATE')
      OR has_any_column_privilege('authenticated', relation_oid, 'REFERENCES')
      OR (
        split_part(relation_name, '.', 1) = 'private'
        AND (
          has_table_privilege('authenticated', relation_oid, 'SELECT')
          OR has_any_column_privilege('authenticated', relation_oid, 'SELECT')
        )
      )
      OR has_table_privilege('anon', relation_oid, 'SELECT')
      OR has_table_privilege('anon', relation_oid, 'INSERT')
      OR has_table_privilege('anon', relation_oid, 'UPDATE')
      OR has_table_privilege('anon', relation_oid, 'DELETE')
      OR has_table_privilege('anon', relation_oid, 'TRUNCATE')
      OR has_table_privilege('anon', relation_oid, 'REFERENCES')
      OR has_table_privilege('anon', relation_oid, 'TRIGGER')
      OR has_any_column_privilege('anon', relation_oid, 'SELECT')
      OR has_any_column_privilege('anon', relation_oid, 'INSERT')
      OR has_any_column_privilege('anon', relation_oid, 'UPDATE')
      OR has_any_column_privilege('anon', relation_oid, 'REFERENCES')
    ) THEN
      RAISE EXCEPTION 'Daily allocation v2 activation validation failed: unsafe relation grants %', relation_name;
    END IF;
  END LOOP;

  FOREACH procedure_signature IN ARRAY ARRAY[
    'public.get_daily_allocation_v2_runtime()',
    'public.convert_daily_allocation_plan_day_v2(date,text)',
    'public.upsert_daily_allocation_visit_v2(uuid,uuid,integer,integer,text,uuid,text,timestamptz,timestamptz,text,text,text)',
    'public.delete_daily_allocation_visit_v2(uuid,integer,integer)',
    'public.assign_daily_allocation_labour_v2(uuid,uuid,integer,text,text,text,uuid)',
    'public.unassign_daily_allocation_labour_v2(uuid,integer)',
    'public.assign_daily_allocation_plant_v2(uuid,integer,text,uuid,text,text,text,text)',
    'public.unassign_daily_allocation_plant_v2(uuid,integer)',
    'public.publish_daily_allocation_plan_v2(uuid,integer,text,boolean)',
    'public.move_daily_allocation_visit_v2(uuid,uuid,integer,integer,integer,timestamptz,timestamptz)',
    'public.create_daily_allocation_conflict_override_v2(uuid,integer,text,text,uuid,uuid)'
  ]
  LOOP
    procedure_oid := to_regprocedure(procedure_signature);
    IF procedure_oid IS NULL THEN
      RAISE EXCEPTION 'Daily allocation v2 activation validation failed: missing procedure %', procedure_signature;
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_proc
      WHERE oid = procedure_oid
        AND prosecdef = TRUE
    ) THEN
      RAISE EXCEPTION 'Daily allocation v2 activation validation failed: procedure is not SECURITY DEFINER: %', procedure_signature;
    END IF;
    IF NOT has_function_privilege('authenticated', procedure_oid, 'EXECUTE')
      OR NOT has_function_privilege('service_role', procedure_oid, 'EXECUTE')
      OR has_function_privilege('anon', procedure_oid, 'EXECUTE')
    THEN
      RAISE EXCEPTION 'Daily allocation v2 activation validation failed: unsafe procedure grants: %', procedure_signature;
    END IF;
  END LOOP;

  IF to_regprocedure('private.require_daily_allocation_v2_writer()') IS NULL THEN
    RAISE EXCEPTION 'Daily allocation v2 activation validation failed: writer guard is missing';
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
    RAISE EXCEPTION 'Daily allocation v2 activation validation failed: expected exactly one runtime singleton';
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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM private.daily_allocation_v2_runtime
    WHERE singleton = TRUE
      AND board_enabled = TRUE
      AND writes_enabled = TRUE
  ) THEN
    RAISE EXCEPTION 'Daily allocation v2 activation failed to reach enabled state';
  END IF;
END;
$$;

COMMIT;
