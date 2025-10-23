-- Add current_mileage column to vehicle_inspections table
ALTER TABLE vehicle_inspections
ADD COLUMN IF NOT EXISTS current_mileage INTEGER;

COMMENT ON COLUMN vehicle_inspections.current_mileage IS 'Current vehicle mileage at time of inspection';

