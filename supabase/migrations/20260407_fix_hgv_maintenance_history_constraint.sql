BEGIN;

ALTER TABLE public.maintenance_history
  DROP CONSTRAINT IF EXISTS check_van_or_plant;

ALTER TABLE public.maintenance_history
  DROP CONSTRAINT IF EXISTS check_maintenance_history_asset;

ALTER TABLE public.maintenance_history
  ADD CONSTRAINT check_maintenance_history_asset
  CHECK (num_nonnulls(van_id, hgv_id, plant_id) = 1);

WITH candidate_history AS (
  SELECT
    dsl.hgv_id,
    dsl.registration_number,
    'tax_due_date'::text AS field_name,
    dsl.tax_due_date_old::text AS old_value,
    dsl.tax_due_date_new::text AS new_value,
    dsl.triggered_by,
    dsl.trigger_type,
    dsl.created_at
  FROM public.dvla_sync_log dsl
  WHERE dsl.hgv_id IS NOT NULL
    AND dsl.sync_status = 'success'
    AND 'tax_due_date' = ANY(COALESCE(dsl.fields_updated, ARRAY[]::text[]))
    AND dsl.tax_due_date_old IS DISTINCT FROM dsl.tax_due_date_new

  UNION ALL

  SELECT
    dsl.hgv_id,
    dsl.registration_number,
    'mot_due_date'::text AS field_name,
    dsl.mot_due_date_old::text AS old_value,
    dsl.mot_due_date_new::text AS new_value,
    dsl.triggered_by,
    dsl.trigger_type,
    dsl.created_at
  FROM public.dvla_sync_log dsl
  WHERE dsl.hgv_id IS NOT NULL
    AND dsl.sync_status = 'success'
    AND 'mot_due_date' = ANY(COALESCE(dsl.fields_updated, ARRAY[]::text[]))
    AND dsl.mot_due_date_old IS DISTINCT FROM dsl.mot_due_date_new
)
INSERT INTO public.maintenance_history (
  hgv_id,
  field_name,
  old_value,
  new_value,
  value_type,
  comment,
  updated_by,
  updated_by_name,
  created_at
)
SELECT
  candidate_history.hgv_id,
  candidate_history.field_name,
  candidate_history.old_value,
  candidate_history.new_value,
  'date',
  CASE
    WHEN candidate_history.field_name = 'tax_due_date'
      THEN format(
        'Backfilled HGV tax due date history from DVLA sync log for %s',
        candidate_history.registration_number
      )
    ELSE format(
      'Backfilled HGV MOT due date history from DVLA sync log for %s',
      candidate_history.registration_number
    )
  END,
  candidate_history.triggered_by,
  CASE
    WHEN candidate_history.trigger_type = 'automatic' THEN 'Scheduled DVLA Sync (backfill)'
    ELSE 'DVLA API Sync (backfill)'
  END,
  candidate_history.created_at
FROM candidate_history
WHERE NOT EXISTS (
  SELECT 1
  FROM public.maintenance_history mh
  WHERE mh.hgv_id = candidate_history.hgv_id
    AND mh.field_name = candidate_history.field_name
    AND mh.old_value IS NOT DISTINCT FROM candidate_history.old_value
    AND mh.new_value IS NOT DISTINCT FROM candidate_history.new_value
);

COMMIT;
