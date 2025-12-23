-- Add MOT expiry date field to vehicle_maintenance table
-- This is separate from the mot_due_date field which was populated manually
-- This field will be auto-populated from the GOV.UK MOT History API

ALTER TABLE vehicle_maintenance
ADD COLUMN IF NOT EXISTS mot_expiry_date DATE;

-- Add comment to clarify the difference between mot_due_date and mot_expiry_date
COMMENT ON COLUMN vehicle_maintenance.mot_due_date IS 'Manually entered MOT due date (legacy field)';
COMMENT ON COLUMN vehicle_maintenance.mot_expiry_date IS 'MOT expiry date from GOV.UK MOT History API';

-- Add index for MOT expiry date queries
CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_mot_expiry_date 
ON vehicle_maintenance(mot_expiry_date);

-- Add MOT History API tracking fields
ALTER TABLE vehicle_maintenance
ADD COLUMN IF NOT EXISTS mot_api_sync_status TEXT,
ADD COLUMN IF NOT EXISTS mot_api_sync_error TEXT,
ADD COLUMN IF NOT EXISTS last_mot_api_sync TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS mot_raw_data JSONB;

COMMENT ON COLUMN vehicle_maintenance.mot_api_sync_status IS 'Status of last MOT History API sync (success/failed)';
COMMENT ON COLUMN vehicle_maintenance.mot_api_sync_error IS 'Error message from last failed MOT API sync';
COMMENT ON COLUMN vehicle_maintenance.last_mot_api_sync IS 'Timestamp of last successful MOT History API sync';
COMMENT ON COLUMN vehicle_maintenance.mot_raw_data IS 'Raw JSON response from MOT History API';

