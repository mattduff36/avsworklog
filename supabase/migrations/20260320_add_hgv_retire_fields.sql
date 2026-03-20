-- Add retire tracking fields to hgvs table (matching plant table pattern)
ALTER TABLE hgvs ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ NULL;
ALTER TABLE hgvs ADD COLUMN IF NOT EXISTS retire_reason VARCHAR(50) NULL;
