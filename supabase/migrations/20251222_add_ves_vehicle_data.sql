-- Migration: Add VES API Vehicle Data Fields
-- Description: Store all vehicle data from GOV.UK VES API
-- Date: 2025-12-22

BEGIN;

-- ============================================================================
-- Add VES vehicle data fields to vehicle_maintenance
-- ============================================================================

-- Basic vehicle info
ALTER TABLE vehicle_maintenance
ADD COLUMN IF NOT EXISTS ves_make VARCHAR(100),
ADD COLUMN IF NOT EXISTS ves_colour VARCHAR(50),
ADD COLUMN IF NOT EXISTS ves_fuel_type VARCHAR(50),
ADD COLUMN IF NOT EXISTS ves_year_of_manufacture INTEGER,
ADD COLUMN IF NOT EXISTS ves_engine_capacity INTEGER;

-- Tax info
ALTER TABLE vehicle_maintenance
ADD COLUMN IF NOT EXISTS ves_tax_status VARCHAR(50);

-- MOT info (status text only, no expiry date available)
ALTER TABLE vehicle_maintenance
ADD COLUMN IF NOT EXISTS ves_mot_status VARCHAR(100);

-- Technical specifications
ALTER TABLE vehicle_maintenance
ADD COLUMN IF NOT EXISTS ves_co2_emissions INTEGER,
ADD COLUMN IF NOT EXISTS ves_euro_status VARCHAR(50),
ADD COLUMN IF NOT EXISTS ves_real_driving_emissions VARCHAR(10),
ADD COLUMN IF NOT EXISTS ves_type_approval VARCHAR(50),
ADD COLUMN IF NOT EXISTS ves_wheelplan VARCHAR(100);

-- Additional info
ALTER TABLE vehicle_maintenance
ADD COLUMN IF NOT EXISTS ves_revenue_weight INTEGER,
ADD COLUMN IF NOT EXISTS ves_marked_for_export BOOLEAN,
ADD COLUMN IF NOT EXISTS ves_month_of_first_registration VARCHAR(10),
ADD COLUMN IF NOT EXISTS ves_date_of_last_v5c_issued DATE;

-- ============================================================================
-- Add indexes for common queries
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_ves_make
  ON vehicle_maintenance(ves_make) WHERE ves_make IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_ves_fuel_type
  ON vehicle_maintenance(ves_fuel_type) WHERE ves_fuel_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_ves_tax_status
  ON vehicle_maintenance(ves_tax_status) WHERE ves_tax_status IS NOT NULL;

-- ============================================================================
-- Add comments
-- ============================================================================

COMMENT ON COLUMN vehicle_maintenance.ves_make IS 'Vehicle make from VES API (e.g., VAUXHALL)';
COMMENT ON COLUMN vehicle_maintenance.ves_colour IS 'Vehicle colour from VES API';
COMMENT ON COLUMN vehicle_maintenance.ves_fuel_type IS 'Fuel type from VES API (e.g., DIESEL)';
COMMENT ON COLUMN vehicle_maintenance.ves_year_of_manufacture IS 'Year of manufacture from VES API';
COMMENT ON COLUMN vehicle_maintenance.ves_engine_capacity IS 'Engine capacity in cc from VES API';
COMMENT ON COLUMN vehicle_maintenance.ves_tax_status IS 'Current tax status from VES API (e.g., Taxed, Untaxed, SORN)';
COMMENT ON COLUMN vehicle_maintenance.ves_mot_status IS 'MOT status text from VES API (e.g., Valid, No details held by DVLA)';
COMMENT ON COLUMN vehicle_maintenance.ves_co2_emissions IS 'CO2 emissions in g/km from VES API';
COMMENT ON COLUMN vehicle_maintenance.ves_euro_status IS 'Euro emissions standard from VES API';
COMMENT ON COLUMN vehicle_maintenance.ves_real_driving_emissions IS 'Real driving emissions category from VES API';
COMMENT ON COLUMN vehicle_maintenance.ves_type_approval IS 'Type approval category from VES API';
COMMENT ON COLUMN vehicle_maintenance.ves_wheelplan IS 'Wheelplan/axle configuration from VES API';
COMMENT ON COLUMN vehicle_maintenance.ves_revenue_weight IS 'Revenue weight in kg from VES API';
COMMENT ON COLUMN vehicle_maintenance.ves_marked_for_export IS 'Whether vehicle is marked for export from VES API';
COMMENT ON COLUMN vehicle_maintenance.ves_month_of_first_registration IS 'Month of first registration from VES API (YYYY-MM format)';
COMMENT ON COLUMN vehicle_maintenance.ves_date_of_last_v5c_issued IS 'Date of last V5C issued from VES API';

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
DECLARE
    column_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO column_count
    FROM information_schema.columns
    WHERE table_name = 'vehicle_maintenance'
      AND column_name LIKE 'ves_%';
    
    RAISE NOTICE '';
    RAISE NOTICE '✅ VES Vehicle Data Migration Complete!';
    RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
    RAISE NOTICE 'Added % VES data columns to vehicle_maintenance', column_count;
    RAISE NOTICE '';
    RAISE NOTICE 'Fields added:';
    RAISE NOTICE '  ✓ ves_make';
    RAISE NOTICE '  ✓ ves_colour';
    RAISE NOTICE '  ✓ ves_fuel_type';
    RAISE NOTICE '  ✓ ves_year_of_manufacture';
    RAISE NOTICE '  ✓ ves_engine_capacity';
    RAISE NOTICE '  ✓ ves_tax_status';
    RAISE NOTICE '  ✓ ves_mot_status';
    RAISE NOTICE '  ✓ ves_co2_emissions';
    RAISE NOTICE '  ✓ ves_euro_status';
    RAISE NOTICE '  ✓ ves_real_driving_emissions';
    RAISE NOTICE '  ✓ ves_type_approval';
    RAISE NOTICE '  ✓ ves_wheelplan';
    RAISE NOTICE '  ✓ ves_revenue_weight';
    RAISE NOTICE '  ✓ ves_marked_for_export';
    RAISE NOTICE '  ✓ ves_month_of_first_registration';
    RAISE NOTICE '  ✓ ves_date_of_last_v5c_issued';
    RAISE NOTICE '';
    RAISE NOTICE 'Next: Run bulk sync to populate data';
    RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
    RAISE NOTICE '';
END $$;

COMMIT;

