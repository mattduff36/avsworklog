-- =============================================================================
-- Add applies_to column to workshop_attachment_templates
-- =============================================================================
-- This migration adds an applies_to array column to track whether a template
-- applies to vehicle tasks, plant tasks, or both.
-- =============================================================================

-- Step 1: Add applies_to column (defaults to both for backward compatibility)
ALTER TABLE workshop_attachment_templates
ADD COLUMN IF NOT EXISTS applies_to TEXT[] NOT NULL DEFAULT '{vehicle,plant}';

-- Step 2: Add index for faster filtering
CREATE INDEX IF NOT EXISTS idx_workshop_attachment_templates_applies_to 
  ON workshop_attachment_templates USING GIN (applies_to);

-- Step 3: Add comment
COMMENT ON COLUMN workshop_attachment_templates.applies_to IS 
  'Array indicating whether this template applies to vehicle tasks, plant tasks, or both. Valid values: vehicle, plant';

-- Verification query (commented out)
-- SELECT name, applies_to, is_active
-- FROM workshop_attachment_templates
-- ORDER BY name;
