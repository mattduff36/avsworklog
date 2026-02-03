-- =============================================================================
-- Add Plant Machinery Maintenance Categories
-- =============================================================================
-- This migration ensures plant-specific hours-based maintenance categories exist
-- for tracking service intervals based on engine hours rather than dates/mileage
-- 
-- Key differences between vehicle and plant categories:
-- - Vehicle: Uses DATE (tax, MOT) and MILEAGE (service) based categories
-- - Plant: Uses HOURS (service) based categories since plant tracks engine hours
-- - LOLER: Remains DATE-based as it's a calendar-based inspection requirement
-- =============================================================================

BEGIN;

-- Ensure the plant-specific service category exists
INSERT INTO maintenance_categories (
  name, 
  description, 
  type,  
  alert_threshold_days, 
  alert_threshold_miles, 
  alert_threshold_hours,
  is_active, 
  responsibility, 
  show_on_overview, 
  applies_to,
  sort_order
) VALUES
  (
    'Service Due (Hours)', 
    'Regular service based on engine hours for plant machinery', 
    'hours',
    NULL, 
    NULL, 
    50,  -- Alert when within 50 hours of service
    true, 
    'workshop', 
    true, 
    ARRAY['plant']::VARCHAR(20)[],
    10
  )
ON CONFLICT (name) DO UPDATE SET
  alert_threshold_hours = EXCLUDED.alert_threshold_hours,
  applies_to = EXCLUDED.applies_to,
  type = EXCLUDED.type,
  description = EXCLUDED.description;

-- You can add LOLER-related categories here if needed (these would be date-based)
-- LOLER inspections are calendar-based, not hours-based
INSERT INTO maintenance_categories (
  name, 
  description, 
  type,  
  alert_threshold_days, 
  alert_threshold_miles, 
  alert_threshold_hours,
  is_active, 
  responsibility, 
  show_on_overview, 
  applies_to,
  sort_order
) VALUES
  (
    'LOLER Due', 
    'LOLER (Lifting Operations and Lifting Equipment Regulations) inspection due date', 
    'date',
    30,  -- Alert 30 days before LOLER due
    NULL, 
    NULL,
    true, 
    'office',  -- Office responsibility as it's a compliance/admin task
    true, 
    ARRAY['plant']::VARCHAR(20)[],
    11
  )
ON CONFLICT (name) DO UPDATE SET
  alert_threshold_days = EXCLUDED.alert_threshold_days,
  applies_to = EXCLUDED.applies_to,
  type = EXCLUDED.type,
  description = EXCLUDED.description,
  responsibility = EXCLUDED.responsibility;

-- Verification output
DO $$
DECLARE
  hours_count INTEGER;
  plant_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO hours_count 
  FROM maintenance_categories 
  WHERE type = 'hours';
  
  SELECT COUNT(*) INTO plant_count 
  FROM maintenance_categories 
  WHERE 'plant' = ANY(applies_to);
  
  RAISE NOTICE '';
  RAISE NOTICE '✅ Plant maintenance categories migration completed!';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE 'Hours-based categories: %', hours_count;
  RAISE NOTICE 'Plant-applicable categories: %', plant_count;
  RAISE NOTICE '';
  RAISE NOTICE 'Categories added:';
  RAISE NOTICE '  ✓ Service Due (Hours) - Workshop responsibility';
  RAISE NOTICE '  ✓ LOLER Due - Office responsibility (date-based compliance)';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '';
END $$;

COMMIT;

-- =============================================================================
-- IMPORTANT NOTES
-- =============================================================================
-- 
-- 1. SERVICE INTERVALS FOR PLANT MACHINERY ARE HOURS-BASED
--    - Plant machinery uses engine hour meters, not odometers
--    - Service intervals are based on operating hours (e.g., service every 250 hours)
--    - These use the 'hours' type with alert_threshold_hours
-- 
-- 2. LOLER INSPECTIONS ARE DATE-BASED (NOT HOURS)
--    - LOLER is a legal requirement based on calendar dates (e.g., every 12 months)
--    - These use the 'date' type with alert_threshold_days
--    - Stored in plant.loler_due_date and plant.loler_last_inspection_date
-- 
-- 3. THRESHOLDS ARE CONFIGURABLE
--    - Admins/Managers can adjust thresholds via Fleet > Settings tab
--    - Default: 50 hours for service alerts, 30 days for LOLER alerts
-- 
-- =============================================================================
