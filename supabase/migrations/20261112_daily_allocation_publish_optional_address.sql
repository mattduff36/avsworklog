-- finalise-phase: predeploy
-- Address is advisory for the first release. Preserve the existing publication
-- transaction, source validation, locks, permissions, replay and immutable history.
BEGIN;

DO $migration$
DECLARE
  definition TEXT;
  original TEXT := $old$job_row := private.apply_allocation_job_fields(
      visit_row.job_source_type,
      visit_row.job_source_id,
      visit_row.job_code,
      TRUE
    );$old$;
  replacement TEXT := $new$job_row := private.apply_daily_allocation_draft_job(
      visit_row.job_source_type,
      visit_row.job_source_id,
      visit_row.job_code
    );$new$;
  notification TEXT := '        published_visits.site_address';
  copy_warning TEXT := 'Draft only: update the canonical job source with a reliable site address before publishing';
BEGIN
  definition := pg_get_functiondef('public.publish_daily_allocation_plan_v2(uuid,integer,text,boolean)'::regprocedure);
  IF (length(definition) - length(replace(definition, original, ''))) / length(original) <> 1
    OR (length(definition) - length(replace(definition, notification, ''))) / length(notification) <> 1 THEN
    RAISE EXCEPTION 'Unexpected daily allocation publish definition; review before applying optional addresses';
  END IF;
  definition := replace(definition, original, replacement);
  definition := replace(definition, notification,
    '        COALESCE(NULLIF(BTRIM(published_visits.site_address), ''''), ''Site address not provided'')');
  EXECUTE definition;

  definition := pg_get_functiondef('public.copy_daily_allocation_plan_v2(uuid,date,date,text,text[],boolean,integer,integer)'::regprocedure);
  IF (length(definition) - length(replace(definition, copy_warning, ''))) / length(copy_warning) <> 1 THEN
    RAISE EXCEPTION 'Unexpected daily allocation copy definition; review before updating address warning';
  END IF;
  EXECUTE replace(definition, copy_warning,
    'Site address missing or unconfirmed. Publishing is allowed; add the address when available.');
END;
$migration$;

COMMIT;
