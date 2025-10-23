-- Add date range columns to vehicle_inspections table
-- inspection_date will become the start date, and we'll add an end date

ALTER TABLE vehicle_inspections
ADD COLUMN IF NOT EXISTS inspection_end_date DATE;

-- Set end date to same as start date for existing records
UPDATE vehicle_inspections
SET inspection_end_date = inspection_date
WHERE inspection_end_date IS NULL;

COMMENT ON COLUMN vehicle_inspections.inspection_date IS 'Start date of the inspection period';
COMMENT ON COLUMN vehicle_inspections.inspection_end_date IS 'End date of the inspection period (max 7 days from start date)';

-- Add a check constraint to ensure end date is not before start date
ALTER TABLE vehicle_inspections
ADD CONSTRAINT check_inspection_date_range 
CHECK (inspection_end_date >= inspection_date);

-- Add a check constraint to ensure date range is max 7 days
ALTER TABLE vehicle_inspections
ADD CONSTRAINT check_inspection_max_7_days 
CHECK (inspection_end_date - inspection_date <= 6);

