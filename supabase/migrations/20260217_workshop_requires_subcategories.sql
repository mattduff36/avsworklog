-- Migration: Add requires_subcategories toggle to workshop_task_categories
-- Date: 2026-02-17
-- Purpose: Allow categories to opt-in/out of requiring subcategories when creating tasks.
--          Only 'Repair (Vehicle)' currently needs subcategories enabled.
-- PRD: docs/PRD_WORKSHOP_TASKS.md (FR-5: Category Management)

-- ========================================
-- STEP 1: ADD COLUMN
-- ========================================

ALTER TABLE workshop_task_categories
  ADD COLUMN IF NOT EXISTS requires_subcategories BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN workshop_task_categories.requires_subcategories
  IS 'When true, users must select a subcategory when creating tasks under this category';

-- ========================================
-- STEP 2: ENABLE SUBCATEGORIES FOR REPAIR (VEHICLE) ONLY
-- ========================================

UPDATE workshop_task_categories
SET requires_subcategories = true
WHERE slug = 'repair' AND applies_to = 'vehicle';

-- ========================================
-- STEP 3: MIGRATE EXISTING ACTIONS
-- Clear workshop_subcategory_id on actions whose parent category
-- does NOT require subcategories. Keep workshop_category_id intact.
-- ========================================

UPDATE actions
SET workshop_subcategory_id = NULL
FROM workshop_task_subcategories s
INNER JOIN workshop_task_categories c ON s.category_id = c.id
WHERE actions.workshop_subcategory_id = s.id
  AND c.requires_subcategories = false;
