-- =============================================================================
-- Set Vehicle-Only Maintenance Categories
-- =============================================================================
-- This migration sets specific maintenance categories to vehicle-only since
-- they don't apply to plant machinery:
-- - Service Due (mileage-based, vehicles have odometers)
-- - MOT Due Date (legal requirement for vehicles only)
-- - Cambelt Replacement (vehicle-specific component)
-- - First Aid Kit Expiry (vehicle-specific requirement)
-- =============================================================================

UPDATE maintenance_categories
SET applies_to = '{vehicle}'
WHERE name IN (
  'Service Due',
  'MOT Due Date',
  'Cambelt Replacement',
  'First Aid Kit Expiry'
);

-- Verification query (commented out)
-- SELECT name, type, applies_to 
-- FROM maintenance_categories 
-- WHERE name IN ('Service Due', 'MOT Due Date', 'Cambelt Replacement', 'First Aid Kit Expiry')
-- ORDER BY name;
