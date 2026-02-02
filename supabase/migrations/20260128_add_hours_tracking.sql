-- Add hours-based tracking fields
ALTER TABLE vehicle_maintenance
ADD COLUMN current_hours INTEGER NULL,
ADD COLUMN last_service_hours INTEGER NULL,
ADD COLUMN next_service_hours INTEGER NULL,
ADD COLUMN last_hours_update TIMESTAMPTZ NULL;
