-- Backfill HGV Full Service and Engine Service category values for completed
-- full/major service workshop tasks that were synced to the legacy Service Due
-- fields after the HGV service split.

BEGIN;

WITH service_categories AS (
  SELECT
    (MAX(id::TEXT) FILTER (WHERE LOWER(name) = 'full service'))::UUID AS full_service_id,
    MAX(period_value) FILTER (WHERE LOWER(name) = 'full service') AS full_service_period,
    (MAX(id::TEXT) FILTER (WHERE LOWER(name) = 'engine service'))::UUID AS engine_service_id,
    MAX(period_value) FILTER (WHERE LOWER(name) = 'engine service') AS engine_service_period
  FROM public.maintenance_categories
  WHERE LOWER(name) IN ('full service', 'engine service')
),
completed_full_services AS (
  SELECT DISTINCT ON (a.id)
    a.id AS action_id,
    a.hgv_id,
    a.title,
    COALESCE(a.actioned_at, a.updated_at, a.created_at) AS completed_at,
    NULLIF(regexp_replace(mh.new_value, '[^0-9]', '', 'g'), '')::INTEGER AS completed_mileage,
    mh.updated_by,
    mh.updated_by_name
  FROM public.actions a
  LEFT JOIN public.workshop_task_categories category ON category.id = a.workshop_category_id
  LEFT JOIN public.workshop_task_subcategories subcategory ON subcategory.id = a.workshop_subcategory_id
  JOIN LATERAL (
    SELECT history.*
    FROM public.maintenance_history history
    WHERE history.hgv_id = a.hgv_id
      AND history.field_name = 'last_service_mileage'
      AND history.created_at BETWEEN COALESCE(a.actioned_at, a.updated_at, a.created_at) - INTERVAL '10 minutes'
        AND COALESCE(a.actioned_at, a.updated_at, a.created_at) + INTERVAL '10 minutes'
    ORDER BY ABS(EXTRACT(EPOCH FROM history.created_at - COALESCE(a.actioned_at, a.updated_at, a.created_at)))
    LIMIT 1
  ) mh ON TRUE
  WHERE a.hgv_id IS NOT NULL
    AND a.status = 'completed'
    AND COALESCE(a.actioned_at, a.updated_at, a.created_at) >= TIMESTAMPTZ '2026-04-30 00:00:00+00'
    AND CONCAT_WS(' ', a.title, a.description, a.workshop_comments, category.name, subcategory.name)
      ~* '\m(major|full)\M.*\mservice\M|\mservice\M.*\m(major|full)\M'
  ORDER BY a.id, mh.created_at DESC
),
target_values AS (
  SELECT
    completed.action_id,
    completed.hgv_id,
    completed.title,
    completed.completed_at,
    categories.full_service_id AS maintenance_category_id,
    'Full Service' AS category_name,
    completed.completed_mileage AS last_mileage,
    completed.completed_mileage + categories.full_service_period AS due_mileage,
    completed.updated_by,
    completed.updated_by_name
  FROM completed_full_services completed
  CROSS JOIN service_categories categories
  WHERE categories.full_service_id IS NOT NULL
    AND completed.completed_mileage IS NOT NULL

  UNION ALL

  SELECT
    completed.action_id,
    completed.hgv_id,
    completed.title,
    completed.completed_at,
    categories.engine_service_id AS maintenance_category_id,
    'Engine Service' AS category_name,
    completed.completed_mileage AS last_mileage,
    completed.completed_mileage + categories.engine_service_period AS due_mileage,
    completed.updated_by,
    completed.updated_by_name
  FROM completed_full_services completed
  CROSS JOIN service_categories categories
  WHERE categories.engine_service_id IS NOT NULL
    AND completed.completed_mileage IS NOT NULL
),
updates_to_apply AS (
  SELECT
    target.*,
    existing.id AS existing_value_id,
    existing.last_mileage AS old_last_mileage,
    existing.due_mileage AS old_due_mileage
  FROM target_values target
  LEFT JOIN public.asset_maintenance_category_values existing
    ON existing.maintenance_category_id = target.maintenance_category_id
   AND existing.hgv_id = target.hgv_id
  WHERE existing.id IS NULL
    OR existing.last_mileage IS DISTINCT FROM target.last_mileage
    OR existing.due_mileage IS DISTINCT FROM target.due_mileage
),
upserted_values AS (
  INSERT INTO public.asset_maintenance_category_values (
    maintenance_category_id,
    hgv_id,
    last_mileage,
    due_mileage,
    last_updated_by,
    last_updated_at
  )
  SELECT
    maintenance_category_id,
    hgv_id,
    last_mileage,
    due_mileage,
    updated_by,
    completed_at
  FROM updates_to_apply
  ON CONFLICT (maintenance_category_id, asset_type, asset_id)
  DO UPDATE SET
    last_mileage = EXCLUDED.last_mileage,
    due_mileage = EXCLUDED.due_mileage,
    last_updated_by = EXCLUDED.last_updated_by,
    last_updated_at = EXCLUDED.last_updated_at,
    updated_at = NOW()
  RETURNING maintenance_category_id, hgv_id
)
INSERT INTO public.maintenance_history (
  hgv_id,
  maintenance_category_id,
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
  update_row.hgv_id,
  update_row.maintenance_category_id,
  'category:' || update_row.category_name,
  CASE
    WHEN update_row.old_last_mileage IS NOT NULL AND update_row.old_due_mileage IS NOT NULL
      THEN update_row.old_last_mileage::TEXT || ' -> ' || update_row.old_due_mileage::TEXT
    WHEN update_row.old_due_mileage IS NOT NULL THEN update_row.old_due_mileage::TEXT
    WHEN update_row.old_last_mileage IS NOT NULL THEN update_row.old_last_mileage::TEXT
    ELSE NULL
  END,
  update_row.last_mileage::TEXT || ' -> ' || update_row.due_mileage::TEXT,
  'mileage',
  'Backfilled HGV service category from completed workshop task: ' || COALESCE(update_row.title, update_row.action_id::TEXT),
  update_row.updated_by,
  update_row.updated_by_name,
  NOW()
FROM updates_to_apply update_row
JOIN upserted_values upserted
  ON upserted.maintenance_category_id = update_row.maintenance_category_id
 AND upserted.hgv_id = update_row.hgv_id;

COMMIT;
