-- Update vehicle types - set all NULL or empty types to 'Van' except TE57 HGV
-- Date: 2025-12-17

-- Update all vehicles with NULL or empty vehicle_type to 'Van'
-- Exclude TE57 HGV (keep it as-is or will be handled separately)
UPDATE vehicles
SET vehicle_type = 'Van'
WHERE (vehicle_type IS NULL OR vehicle_type = '')
  AND reg_number != 'TE57 HGV';

-- Optional: Set TE57 HGV to 'HGV' if it's currently NULL/empty
-- Uncomment the following lines if TE57 HGV needs to be set to 'HGV'
-- UPDATE vehicles
-- SET vehicle_type = 'HGV'
-- WHERE reg_number = 'TE57 HGV'
--   AND (vehicle_type IS NULL OR vehicle_type = '');
