-- Add canonical current mileage to HGV assets and backfill from latest inspections.

ALTER TABLE public.hgvs
ADD COLUMN IF NOT EXISTS current_mileage integer;

WITH latest_hgv_mileage AS (
  SELECT DISTINCT ON (hgv_id)
    hgv_id,
    current_mileage
  FROM public.hgv_inspections
  WHERE current_mileage IS NOT NULL
  ORDER BY hgv_id, inspection_date DESC, submitted_at DESC NULLS LAST
)
UPDATE public.hgvs AS h
SET current_mileage = latest_hgv_mileage.current_mileage
FROM latest_hgv_mileage
WHERE h.id = latest_hgv_mileage.hgv_id
  AND h.current_mileage IS DISTINCT FROM latest_hgv_mileage.current_mileage;
