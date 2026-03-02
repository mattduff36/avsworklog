-- Add HGV-specific maintenance due-date fields and seed missing categories.
-- Preserves existing configured periods and thresholds where data already exists.

ALTER TABLE public.vehicle_maintenance
ADD COLUMN IF NOT EXISTS six_weekly_inspection_due_date DATE NULL,
ADD COLUMN IF NOT EXISTS fire_extinguisher_due_date DATE NULL,
ADD COLUMN IF NOT EXISTS taco_calibration_due_date DATE NULL;

-- Ensure shared categories can apply to HGV as well as existing asset types.
UPDATE public.maintenance_categories
SET applies_to = ARRAY(
  SELECT DISTINCT value
  FROM unnest(COALESCE(applies_to, ARRAY[]::TEXT[]) || ARRAY['hgv']) AS value
)
WHERE name IN ('Tax Due Date', 'MOT Due Date', 'Service Due', 'First Aid Kit Expiry');

-- Add missing HGV categories (date-based defaults).
INSERT INTO public.maintenance_categories (
  name,
  description,
  type,
  period_value,
  alert_threshold_days,
  alert_threshold_miles,
  alert_threshold_hours,
  applies_to,
  is_active,
  sort_order,
  responsibility,
  show_on_overview,
  reminder_in_app_enabled,
  reminder_email_enabled
)
SELECT
  category_name,
  category_description,
  'date',
  default_period_months,
  default_threshold_days,
  NULL,
  NULL,
  ARRAY['hgv'],
  TRUE,
  sort_order,
  'workshop',
  TRUE,
  FALSE,
  FALSE
FROM (
  VALUES
    ('6 Weekly Inspection Due', 'HGV six-weekly inspection due date', 2, 7, 130),
    ('Fire Extinguisher Due', 'Fire extinguisher inspection/expiry due date', 12, 30, 131),
    ('Taco Calibration Due', 'Tachograph calibration due date', 24, 60, 132)
) AS new_categories(category_name, category_description, default_period_months, default_threshold_days, sort_order)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.maintenance_categories existing
  WHERE existing.name = category_name
);

