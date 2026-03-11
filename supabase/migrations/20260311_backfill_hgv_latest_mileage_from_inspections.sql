-- Backfill HGV mileage from latest available HGV inspections.
-- Updates:
--   1) hgvs.current_mileage
--   2) vehicle_maintenance.current_mileage (for fleet/history views)

WITH latest_hgv_mileage AS (
  SELECT DISTINCT ON (hi.hgv_id)
    hi.hgv_id,
    hi.current_mileage
  FROM public.hgv_inspections hi
  WHERE hi.hgv_id IS NOT NULL
    AND hi.current_mileage IS NOT NULL
  ORDER BY
    hi.hgv_id,
    hi.inspection_date DESC,
    hi.submitted_at DESC NULLS LAST,
    hi.created_at DESC,
    hi.id DESC
)
UPDATE public.hgvs h
SET current_mileage = lhm.current_mileage
FROM latest_hgv_mileage lhm
WHERE h.id = lhm.hgv_id
  AND h.current_mileage IS DISTINCT FROM lhm.current_mileage;

WITH latest_hgv_mileage AS (
  SELECT DISTINCT ON (hi.hgv_id)
    hi.hgv_id,
    hi.current_mileage
  FROM public.hgv_inspections hi
  WHERE hi.hgv_id IS NOT NULL
    AND hi.current_mileage IS NOT NULL
  ORDER BY
    hi.hgv_id,
    hi.inspection_date DESC,
    hi.submitted_at DESC NULLS LAST,
    hi.created_at DESC,
    hi.id DESC
)
UPDATE public.vehicle_maintenance vm
SET
  current_mileage = lhm.current_mileage,
  last_mileage_update = NOW(),
  updated_at = NOW(),
  last_updated_at = NOW()
FROM latest_hgv_mileage lhm
WHERE vm.hgv_id = lhm.hgv_id
  AND vm.current_mileage IS DISTINCT FROM lhm.current_mileage;

WITH latest_hgv_mileage AS (
  SELECT DISTINCT ON (hi.hgv_id)
    hi.hgv_id,
    hi.current_mileage
  FROM public.hgv_inspections hi
  WHERE hi.hgv_id IS NOT NULL
    AND hi.current_mileage IS NOT NULL
  ORDER BY
    hi.hgv_id,
    hi.inspection_date DESC,
    hi.submitted_at DESC NULLS LAST,
    hi.created_at DESC,
    hi.id DESC
)
INSERT INTO public.vehicle_maintenance (
  hgv_id,
  current_mileage,
  last_mileage_update,
  updated_at,
  last_updated_at
)
SELECT
  lhm.hgv_id,
  lhm.current_mileage,
  NOW(),
  NOW(),
  NOW()
FROM latest_hgv_mileage lhm
LEFT JOIN public.vehicle_maintenance vm
  ON vm.hgv_id = lhm.hgv_id
WHERE vm.id IS NULL;
