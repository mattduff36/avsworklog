-- Add signature fields to vehicle_inspections table

ALTER TABLE vehicle_inspections
ADD COLUMN IF NOT EXISTS signature_data TEXT;

ALTER TABLE vehicle_inspections
ADD COLUMN IF NOT EXISTS signed_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN vehicle_inspections.signature_data IS 'Base64 encoded signature image data';
COMMENT ON COLUMN vehicle_inspections.signed_at IS 'Timestamp when the inspection was signed';

