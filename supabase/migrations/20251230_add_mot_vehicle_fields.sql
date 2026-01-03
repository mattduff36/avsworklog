-- Migration: Add MOT API vehicle-level fields
-- Description: Add fields for storing vehicle data from MOT History API (make, model, year, etc.)
-- Date: 2025-01-04

-- Add MOT vehicle-level fields to vehicle_maintenance table
ALTER TABLE vehicle_maintenance
ADD COLUMN IF NOT EXISTS mot_year_of_manufacture INTEGER,
ADD COLUMN IF NOT EXISTS mot_first_used_date DATE;

-- Update column comments for documentation
COMMENT ON COLUMN vehicle_maintenance.mot_make IS 'Vehicle make from MOT History API';
COMMENT ON COLUMN vehicle_maintenance.mot_model IS 'Vehicle model from MOT History API';
COMMENT ON COLUMN vehicle_maintenance.mot_fuel_type IS 'Fuel type from MOT History API';
COMMENT ON COLUMN vehicle_maintenance.mot_primary_colour IS 'Primary colour from MOT History API';
COMMENT ON COLUMN vehicle_maintenance.mot_year_of_manufacture IS 'Manufacture year from MOT History API';
COMMENT ON COLUMN vehicle_maintenance.mot_first_used_date IS 'First registration date from MOT History API';
COMMENT ON COLUMN vehicle_maintenance.mot_registration IS 'Registration number from MOT History API';

