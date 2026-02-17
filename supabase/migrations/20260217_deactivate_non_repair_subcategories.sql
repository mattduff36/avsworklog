-- Migration: Deactivate non-Repair subcategories and migrate existing actions
-- Date: 2026-02-17
-- Purpose: Only "Repair (Vehicle)" retains active subcategories.
--          All subcategories under other categories are deactivated.
--          Existing actions referencing deactivated subcategories are migrated
--          to store workshop_category_id directly and clear workshop_subcategory_id.
-- PRD: docs/PRD_WORKSHOP_TASKS.md (FR-5: Category Management)

BEGIN;

-- ========================================
-- STEP 1: Identify the Repair (Vehicle) category
-- ========================================

-- We preserve subcategories only for the category with slug='repair' AND applies_to='vehicle'.
-- All other categories' subcategories will be deactivated.

-- ========================================
-- STEP 2: Migrate existing actions off non-Repair subcategories
-- ========================================
-- For any action that references a subcategory belonging to a non-Repair category:
--   - Set workshop_category_id to the parent category (from the subcategory's category_id)
--   - Set workshop_subcategory_id to NULL

UPDATE actions
SET
  workshop_category_id = s.category_id,
  workshop_subcategory_id = NULL
FROM workshop_task_subcategories s
INNER JOIN workshop_task_categories c ON s.category_id = c.id
WHERE actions.workshop_subcategory_id = s.id
  AND NOT (c.slug = 'repair' AND c.applies_to = 'vehicle');

-- ========================================
-- STEP 3: Deactivate all subcategories NOT under Repair (Vehicle)
-- ========================================

UPDATE workshop_task_subcategories
SET is_active = false
WHERE category_id NOT IN (
  SELECT id
  FROM workshop_task_categories
  WHERE slug = 'repair' AND applies_to = 'vehicle'
);

COMMIT;
