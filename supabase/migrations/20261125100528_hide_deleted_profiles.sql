-- finalise-phase: predeploy
BEGIN;

-- Existing SELECT policies continue to decide access to active profiles.
-- Service-role queries used by the protected Deleted Users page bypass RLS.
CREATE POLICY profiles_hide_deleted_on_select ON public.profiles
  AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING (deleted_at IS NULL AND COALESCE(full_name, '') NOT ILIKE '%(Deleted User)%');

-- Security-definer Daily Allocation routines bypass the profiles policy.
-- Keep their active subject scope consistent with the board, without changing
-- existing visits, historical publications, or the publication transaction.
DO $migration$
DECLARE
  routine REGPROCEDURE;
  definition TEXT;
  anchor TEXT := 'AND NOT private.is_hidden_daily_allocation_profile(profiles.employee_id, profiles.full_name)';
  predicate TEXT := 'AND profiles.deleted_at IS NULL
    AND COALESCE(profiles.full_name, '''') NOT ILIKE ''%(Deleted User)%''
    ';
BEGIN
  FOREACH routine IN ARRAY ARRAY[
    'public.list_daily_allocation_scope_profile_ids()'::regprocedure,
    'private.prepare_daily_allocation_publication()'::regprocedure,
    'public.publish_daily_allocation_plan_v2(uuid,integer,text,boolean)'::regprocedure
  ]
  LOOP
    definition := pg_get_functiondef(routine);
    IF (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 THEN
      RAISE EXCEPTION 'Unexpected Daily Allocation profile scope in %', routine;
    END IF;

    EXECUTE replace(definition, anchor, predicate || anchor);
  END LOOP;
END;
$migration$;

COMMIT;
