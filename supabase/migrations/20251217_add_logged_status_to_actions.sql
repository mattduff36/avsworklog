-- Add 'logged' status to actions table
-- This allows managers to acknowledge defects that don't need immediate fixing

-- Step 1: Drop existing status constraint
ALTER TABLE actions DROP CONSTRAINT IF EXISTS actions_status_check;

-- Step 2: Add new status constraint with 'logged' included
ALTER TABLE actions ADD CONSTRAINT actions_status_check 
  CHECK (status IN ('pending', 'in_progress', 'logged', 'completed'));

-- Step 3: Add logged_comment field (40 char max)
ALTER TABLE actions ADD COLUMN IF NOT EXISTS logged_comment TEXT;

-- Step 4: Add logged timestamp
ALTER TABLE actions ADD COLUMN IF NOT EXISTS logged_at TIMESTAMPTZ;

-- Step 5: Add logged_by user reference
ALTER TABLE actions ADD COLUMN IF NOT EXISTS logged_by UUID REFERENCES auth.users(id);

-- Step 6: Add comments to document the new fields
COMMENT ON COLUMN actions.status IS 
  'Action status: pending (new), in_progress (being worked on), logged (acknowledged but not fixed), completed (resolved)';

COMMENT ON COLUMN actions.logged_comment IS 
  'Manager/admin comment when marking as logged (max 40 chars). Shows in inspection form as read-only defect.';

COMMENT ON COLUMN actions.logged_at IS 
  'Timestamp when action was marked as logged';

COMMENT ON COLUMN actions.logged_by IS 
  'User ID who marked the action as logged';

-- Step 7: Add index for logged actions queries
CREATE INDEX IF NOT EXISTS idx_actions_status_logged ON actions(status) WHERE status = 'logged';
