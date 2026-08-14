-- finalise-phase: predeploy
-- DA2A-C91E: enforce the existing RPC-only v2 contract on production.
-- RLS remains enabled as defence in depth; authenticated clients keep scoped
-- SELECT on public v2 tables but cannot invoke table or column DML directly.
BEGIN;

DO $$
DECLARE
  relation_name TEXT;
  relation_oid REGCLASS;
  column_list TEXT;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'public.daily_allocation_plan_days',
    'public.daily_allocation_visits',
    'public.daily_allocation_visit_labour',
    'public.daily_allocation_visit_plant',
    'public.daily_allocation_conflict_overrides',
    'public.daily_allocation_published_visits',
    'public.daily_allocation_published_labour',
    'public.daily_allocation_published_plant',
    'public.daily_allocation_published_overrides',
    'public.daily_allocation_publication_notifications',
    'private.daily_allocation_v2_runtime',
    'private.daily_allocation_plant_day_jobs'
  ]
  LOOP
    relation_oid := to_regclass(relation_name);
    IF relation_oid IS NULL THEN
      RAISE EXCEPTION 'Daily allocation v2 grant hardening failed: missing relation %', relation_name;
    END IF;

    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON TABLE %s FROM PUBLIC, anon',
      relation_oid
    );
    IF split_part(relation_name, '.', 1) = 'public' THEN
      EXECUTE format(
        'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE %s FROM authenticated',
        relation_oid
      );
    ELSE
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE %s FROM authenticated',
        relation_oid
      );
    END IF;

    SELECT string_agg(quote_ident(attributes.attname), ', ' ORDER BY attributes.attnum)
    INTO column_list
    FROM pg_attribute attributes
    WHERE attributes.attrelid = relation_oid
      AND attributes.attnum > 0
      AND NOT attributes.attisdropped;

    IF column_list IS NOT NULL THEN
      EXECUTE format(
        'REVOKE SELECT (%1$s), INSERT (%1$s), UPDATE (%1$s), REFERENCES (%1$s) ON TABLE %2$s FROM authenticated, anon',
        column_list,
        relation_oid
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_class relations
      WHERE relations.oid = relation_oid
        AND relations.relkind IN ('r', 'p')
    ) THEN
      RAISE EXCEPTION 'Daily allocation v2 grant hardening failed: unexpected relation type %', relation_name;
    END IF;
    IF split_part(relation_name, '.', 1) = 'public'
      AND (
        NOT has_table_privilege('authenticated', relation_oid, 'SELECT')
        OR NOT EXISTS (
          SELECT 1
          FROM pg_class relations
          WHERE relations.oid = relation_oid
            AND relations.relrowsecurity = TRUE
        )
      )
    THEN
      RAISE EXCEPTION 'Daily allocation v2 grant hardening failed: scoped read/RLS contract failed on %', relation_name;
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
      RAISE EXCEPTION 'Daily allocation v2 grant hardening failed: unsafe grants remain on %', relation_name;
    END IF;
  END LOOP;
END;
$$;

COMMIT;
