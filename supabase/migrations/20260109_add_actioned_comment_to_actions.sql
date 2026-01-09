-- Add actioned_comment field to actions table for completion notes
-- This field stores detailed notes when workshop tasks are marked as completed

-- Add actioned_comment column (nullable, max 500 chars enforced at app level)
ALTER TABLE actions ADD COLUMN IF NOT EXISTS actioned_comment TEXT;

-- Add comment to document the field
COMMENT ON COLUMN actions.actioned_comment IS 
  'Detailed completion notes when task is marked as complete (max 500 chars). Provides audit trail of work done.';

-- Create index for queries that need to filter by completed tasks with comments
CREATE INDEX IF NOT EXISTS idx_actions_actioned_comment 
  ON actions(actioned_comment) 
  WHERE actioned_comment IS NOT NULL;
