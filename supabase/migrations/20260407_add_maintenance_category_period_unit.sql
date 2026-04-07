-- Migration: Add period_unit to maintenance_categories
-- Date: 2026-04-07
-- Purpose:
--   1. Support weekly as well as monthly date-based maintenance periods
--   2. Preserve explicit unit metadata for all maintenance category types
--   3. Correct the HGV 6 weekly inspection category to 6 weeks

BEGIN;

ALTER TABLE public.maintenance_categories
ADD COLUMN IF NOT EXISTS period_unit TEXT;

UPDATE public.maintenance_categories
SET period_unit = 'months'
WHERE type = 'date'
  AND period_unit IS NULL;

UPDATE public.maintenance_categories
SET period_unit = 'miles'
WHERE type = 'mileage'
  AND period_unit IS NULL;

UPDATE public.maintenance_categories
SET period_unit = 'hours'
WHERE type = 'hours'
  AND period_unit IS NULL;

UPDATE public.maintenance_categories
SET
  period_value = 6,
  period_unit = 'weeks'
WHERE LOWER(name) = '6 weekly inspection due'
  AND type = 'date';

ALTER TABLE public.maintenance_categories
ALTER COLUMN period_unit SET NOT NULL;

ALTER TABLE public.maintenance_categories
DROP CONSTRAINT IF EXISTS check_maintenance_categories_period_unit;

ALTER TABLE public.maintenance_categories
ADD CONSTRAINT check_maintenance_categories_period_unit CHECK (
  (type = 'date' AND period_unit IN ('weeks', 'months'))
  OR (type = 'mileage' AND period_unit = 'miles')
  OR (type = 'hours' AND period_unit = 'hours')
);

COMMENT ON COLUMN public.maintenance_categories.period_unit IS
  'Due interval unit for the category. Date categories support weeks or months; mileage uses miles; hours uses hours.';

COMMIT;
