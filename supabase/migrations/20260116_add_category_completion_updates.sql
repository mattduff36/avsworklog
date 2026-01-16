-- Migration: Add completion_updates to workshop_task_categories
-- Date: 2026-01-16
-- Purpose: Enable category-specific maintenance field updates on task completion

-- Add completion_updates column with safe default
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'workshop_task_categories'
      AND column_name = 'completion_updates'
  ) THEN
    ALTER TABLE workshop_task_categories
      ADD COLUMN completion_updates JSONB DEFAULT '[]'::jsonb;
  END IF;
END $$;

-- Seed Service category with next_service_mileage update config
UPDATE workshop_task_categories
SET completion_updates = '[
  {
    "target": "vehicle_maintenance",
    "field_name": "next_service_mileage",
    "value_type": "mileage",
    "label": "Next Service Due (miles)",
    "required": false,
    "help_text": "Enter the mileage when the next service is due"
  }
]'::jsonb
WHERE name ILIKE '%service%'
  AND applies_to = 'vehicle'
  AND (completion_updates IS NULL OR jsonb_array_length(completion_updates) = 0);

-- Add comment for documentation
COMMENT ON COLUMN workshop_task_categories.completion_updates IS 
  'JSONB array of maintenance field updates to prompt for when completing tasks of this category. Each item: {target, field_name, value_type, label, required, help_text}';
