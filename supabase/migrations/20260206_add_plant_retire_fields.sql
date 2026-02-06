-- =============================================================================
-- Add retire metadata fields to plant table
-- =============================================================================
-- Adds retired_at and retire_reason columns so the Retired Plant tab can
-- display the same information as the Retired Vehicles tab (date + reason).
-- =============================================================================

ALTER TABLE plant ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ NULL;
ALTER TABLE plant ADD COLUMN IF NOT EXISTS retire_reason VARCHAR(50) NULL;

COMMENT ON COLUMN plant.retired_at IS 'Timestamp when the plant was retired';
COMMENT ON COLUMN plant.retire_reason IS 'Reason for retirement (Sold, Scrapped, Other)';
