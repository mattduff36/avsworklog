-- =============================================================================
-- Legacy retirement: drop the vehicle_inspections compatibility view
-- =============================================================================
-- Run ONLY after confirming:
--   1. All code paths use van_inspections / plant_inspections directly
--   2. No runtime queries hit the vehicle_inspections view
--   3. All smoke tests pass against the new tables
-- =============================================================================

DROP VIEW IF EXISTS vehicle_inspections;
