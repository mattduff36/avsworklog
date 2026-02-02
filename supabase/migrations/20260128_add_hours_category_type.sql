-- Extend type CHECK to include 'hours'
ALTER TABLE maintenance_categories
DROP CONSTRAINT IF EXISTS maintenance_categories_type_check;

ALTER TABLE maintenance_categories
ADD CONSTRAINT maintenance_categories_type_check
  CHECK (type IN ('date', 'mileage', 'hours'));

-- Add alert_threshold_hours
ALTER TABLE maintenance_categories
ADD COLUMN alert_threshold_hours INTEGER NULL;

-- Add applies_to field to limit categories to asset types
ALTER TABLE maintenance_categories
ADD COLUMN applies_to VARCHAR(20)[] DEFAULT ARRAY['vehicle', 'plant'];
