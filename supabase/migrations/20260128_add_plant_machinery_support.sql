-- Add asset_type to distinguish vehicles from plant
ALTER TABLE vehicles
ADD COLUMN asset_type VARCHAR(20) DEFAULT 'vehicle'
  CHECK (asset_type IN ('vehicle', 'plant', 'tool'));

-- Add plant_id for plant machinery identifier
ALTER TABLE vehicles
ADD COLUMN plant_id VARCHAR(50) NULL;

-- Add new plant-specific fields
ALTER TABLE vehicles
ADD COLUMN serial_number VARCHAR(100) NULL,
ADD COLUMN year INTEGER NULL,
ADD COLUMN weight_class VARCHAR(50) NULL;

-- Make reg_number nullable (currently NOT NULL)
ALTER TABLE vehicles
ALTER COLUMN reg_number DROP NOT NULL;

-- Add constraint: vehicles require reg_number, plant requires plant_id
ALTER TABLE vehicles
ADD CONSTRAINT check_identifier CHECK (
  (asset_type = 'vehicle' AND reg_number IS NOT NULL) OR
  (asset_type = 'plant' AND plant_id IS NOT NULL) OR
  (asset_type = 'tool')
);

-- Add unique index on plant_id (only for non-null values)
CREATE UNIQUE INDEX idx_vehicles_plant_id_unique
ON vehicles (plant_id) WHERE plant_id IS NOT NULL;

-- Update existing records to have asset_type = 'vehicle'
UPDATE vehicles SET asset_type = 'vehicle' WHERE asset_type IS NULL;

-- Create index for filtering by asset_type
CREATE INDEX idx_vehicles_asset_type ON vehicles(asset_type);

-- Create index for serial_number lookups
CREATE INDEX idx_vehicles_serial_number ON vehicles(serial_number) WHERE serial_number IS NOT NULL;
