-- =============================================================================
-- Fix 'vehicle' -> 'van' in maintenance_categories.applies_to
-- =============================================================================
-- The migration 20260204_set_vehicle_only_maintenance_categories.sql
-- incorrectly set applies_to = '{vehicle}' instead of '{van}'.
-- The TypeScript types use 'van' | 'plant' | 'hgv', so the 'vehicle' value
-- causes the 'V' badge to not appear in the Settings UI.
-- =============================================================================

UPDATE maintenance_categories
SET applies_to = array_replace(applies_to, 'vehicle', 'van')
WHERE 'vehicle' = ANY(applies_to);
