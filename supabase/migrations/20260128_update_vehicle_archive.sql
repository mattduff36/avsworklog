-- Make reg_number nullable in archive table
ALTER TABLE vehicle_archive
ALTER COLUMN reg_number DROP NOT NULL;

-- Add plant_id, asset_type, and new plant-specific fields
ALTER TABLE vehicle_archive
ADD COLUMN plant_id VARCHAR(50) NULL,
ADD COLUMN asset_type VARCHAR(20) DEFAULT 'vehicle',
ADD COLUMN serial_number VARCHAR(100) NULL,
ADD COLUMN year INTEGER NULL,
ADD COLUMN weight_class VARCHAR(50) NULL;
