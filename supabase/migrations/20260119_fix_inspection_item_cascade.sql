-- Migration: Fix inspection_item_id CASCADE DELETE
-- Date: 2026-01-19
-- Purpose: Change FK constraint from CASCADE to SET NULL to prevent workshop tasks
--          from being deleted when inspection_items are recreated during draft edits

-- Drop existing constraint
ALTER TABLE actions
DROP CONSTRAINT IF EXISTS actions_inspection_item_id_fkey;

-- Add new constraint with SET NULL behavior
ALTER TABLE actions
ADD CONSTRAINT actions_inspection_item_id_fkey
  FOREIGN KEY (inspection_item_id)
  REFERENCES inspection_items(id)
  ON DELETE SET NULL;

-- Add comment explaining the change
COMMENT ON CONSTRAINT actions_inspection_item_id_fkey ON actions IS 
'SET NULL on delete prevents CASCADE deletion of workshop tasks when inspection items are recreated during draft edits. Tasks remain linked via stable signature (vehicle_id + item_number + description).';
