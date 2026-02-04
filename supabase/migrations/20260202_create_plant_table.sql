-- =============================================================================
-- Plant Table Split Migration
-- =============================================================================
-- This migration creates a dedicated plant table and migrates existing plant
-- rows from the vehicles table
-- 
-- Part 1: Create Plant Table
-- Part 2: Add plant_id columns to related tables
-- Part 3: Migrate existing plant data
-- Part 4: Update RLS policies
-- =============================================================================

-- =============================================================================
-- Part 1: Create Plant Table
-- =============================================================================

CREATE TABLE IF NOT EXISTS plant (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Core identification fields
  plant_id VARCHAR(50) UNIQUE NOT NULL,
  nickname VARCHAR(255) NULL,
  
  -- Asset details
  make VARCHAR(100) NULL,
  model VARCHAR(100) NULL,
  serial_number VARCHAR(100) NULL,
  year INTEGER NULL,
  weight_class VARCHAR(50) NULL,
  
  -- Category relationship (reuse existing vehicle_categories)
  category_id UUID NOT NULL REFERENCES vehicle_categories(id),
  
  -- LOLER (Lifting Operations and Lifting Equipment Regulations) fields
  loler_due_date DATE NULL,
  loler_last_inspection_date DATE NULL,
  loler_certificate_number VARCHAR(100) NULL,
  loler_inspection_interval_months INTEGER DEFAULT 12,
  
  -- Meter readings (hours-based for plant)
  current_hours INTEGER NULL,
  
  -- Status
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'maintenance', 'retired')),
  
  -- Audit fields
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id),
  updated_by UUID REFERENCES profiles(id)
);

-- Indexes for plant table
CREATE INDEX idx_plant_plant_id ON plant(plant_id);
CREATE INDEX idx_plant_status ON plant(status);
CREATE INDEX idx_plant_category_id ON plant(category_id);
CREATE INDEX idx_plant_loler_due_date ON plant(loler_due_date) WHERE loler_due_date IS NOT NULL;
CREATE INDEX idx_plant_serial_number ON plant(serial_number) WHERE serial_number IS NOT NULL;

-- Updated at trigger for plant
CREATE OR REPLACE FUNCTION update_plant_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER plant_updated_at_trigger
BEFORE UPDATE ON plant
FOR EACH ROW
EXECUTE FUNCTION update_plant_updated_at();

-- =============================================================================
-- Part 2: Add plant_id columns to related tables
-- =============================================================================

-- First, make vehicle_id nullable in tables that will support plant_id
ALTER TABLE actions
ALTER COLUMN vehicle_id DROP NOT NULL;

ALTER TABLE vehicle_inspections
ALTER COLUMN vehicle_id DROP NOT NULL;

ALTER TABLE vehicle_maintenance
ALTER COLUMN vehicle_id DROP NOT NULL;

-- Add plant_id to actions (workshop tasks)
ALTER TABLE actions
ADD COLUMN plant_id UUID NULL REFERENCES plant(id) ON DELETE CASCADE;

CREATE INDEX idx_actions_plant_id ON actions(plant_id) WHERE plant_id IS NOT NULL;

-- Add constraint: either vehicle_id OR plant_id must be set, not both
-- (allows NULL for both to support legacy/system actions)
ALTER TABLE actions
ADD CONSTRAINT check_actions_asset CHECK (
  (vehicle_id IS NOT NULL AND plant_id IS NULL) OR
  (vehicle_id IS NULL AND plant_id IS NOT NULL) OR
  (vehicle_id IS NULL AND plant_id IS NULL)
);

-- Add plant_id to vehicle_inspections
ALTER TABLE vehicle_inspections
ADD COLUMN plant_id UUID NULL REFERENCES plant(id) ON DELETE CASCADE;

CREATE INDEX idx_vehicle_inspections_plant_id ON vehicle_inspections(plant_id) WHERE plant_id IS NOT NULL;

-- Note: vehicle_inspections always requires either vehicle_id or plant_id
ALTER TABLE vehicle_inspections
ADD CONSTRAINT check_inspections_asset CHECK (
  (vehicle_id IS NOT NULL AND plant_id IS NULL) OR
  (vehicle_id IS NULL AND plant_id IS NOT NULL)
);

-- Add plant_id to vehicle_maintenance
ALTER TABLE vehicle_maintenance
ADD COLUMN plant_id UUID NULL REFERENCES plant(id) ON DELETE CASCADE;

CREATE INDEX idx_vehicle_maintenance_plant_id ON vehicle_maintenance(plant_id) WHERE plant_id IS NOT NULL;

-- Note: vehicle_maintenance always requires either vehicle_id or plant_id
ALTER TABLE vehicle_maintenance
ADD CONSTRAINT check_maintenance_asset CHECK (
  (vehicle_id IS NOT NULL AND plant_id IS NULL) OR
  (vehicle_id IS NULL AND plant_id IS NOT NULL)
);

-- =============================================================================
-- Part 3: Migrate existing plant data from vehicles to plant table
-- =============================================================================

-- Insert plant rows from vehicles where asset_type = 'plant'
INSERT INTO plant (
  id,
  plant_id,
  nickname,
  make,
  model,
  serial_number,
  year,
  weight_class,
  category_id,
  loler_due_date,
  loler_last_inspection_date,
  current_hours,
  status,
  created_at,
  updated_at
)
SELECT 
  v.id,
  v.plant_id,
  v.nickname,
  NULL as make,  -- Not in old vehicles table
  NULL as model,  -- Not in old vehicles table
  v.serial_number,
  v.year,
  v.weight_class,
  v.category_id,
  NULL as loler_due_date,  -- New field, set to NULL
  NULL as loler_last_inspection_date,  -- New field, set to NULL
  vm.current_hours,  -- Get from vehicle_maintenance if exists
  v.status,
  v.created_at,
  NOW() as updated_at
FROM vehicles v
LEFT JOIN vehicle_maintenance vm ON vm.vehicle_id = v.id
WHERE v.asset_type = 'plant';

-- Update actions to reference plant_id instead of vehicle_id
UPDATE actions a
SET plant_id = v.id,
    vehicle_id = NULL
FROM vehicles v
WHERE a.vehicle_id = v.id
AND v.asset_type = 'plant';

-- Update vehicle_inspections to reference plant_id instead of vehicle_id
UPDATE vehicle_inspections vi
SET plant_id = v.id,
    vehicle_id = NULL
FROM vehicles v
WHERE vi.vehicle_id = v.id
AND v.asset_type = 'plant';

-- Update vehicle_maintenance to reference plant_id instead of vehicle_id
UPDATE vehicle_maintenance vm
SET plant_id = v.id,
    vehicle_id = NULL
FROM vehicles v
WHERE vm.vehicle_id = v.id
AND v.asset_type = 'plant';

-- Delete plant rows from vehicles table (they're now in plant table)
DELETE FROM vehicles WHERE asset_type = 'plant';

-- =============================================================================
-- Part 4: RLS Policies for Plant Table
-- =============================================================================

-- Enable RLS
ALTER TABLE plant ENABLE ROW LEVEL SECURITY;

-- Policy: Everyone can read active plant
CREATE POLICY "plant_read_policy"
ON plant FOR SELECT
TO authenticated
USING (status = 'active' OR status = 'maintenance');

-- Policy: Admins can insert plant
CREATE POLICY "plant_insert_policy"
ON plant FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin', 'manager')
  )
);

-- Policy: Admins and managers can update plant
CREATE POLICY "plant_update_policy"
ON plant FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin', 'manager')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin', 'manager')
  )
);

-- Policy: Only admins can delete plant
CREATE POLICY "plant_delete_policy"
ON plant FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'admin'
  )
);

-- =============================================================================
-- Part 5: Update existing RLS policies for modified tables
-- =============================================================================

-- Note: Existing RLS policies on actions, vehicle_inspections, and 
-- vehicle_maintenance should already work with plant_id since they
-- check for authenticated users. No changes needed unless there are
-- vehicle-specific constraints.

-- =============================================================================
-- Comments
-- =============================================================================

COMMENT ON TABLE plant IS 'Plant machinery and equipment with LOLER compliance tracking';
COMMENT ON COLUMN plant.plant_id IS 'Unique identifier for the plant asset (e.g., "P001", "EXC-01")';
COMMENT ON COLUMN plant.loler_due_date IS 'Next LOLER inspection due date';
COMMENT ON COLUMN plant.loler_last_inspection_date IS 'Date of last LOLER inspection';
COMMENT ON COLUMN plant.loler_certificate_number IS 'LOLER certificate/report reference number';
COMMENT ON COLUMN plant.loler_inspection_interval_months IS 'Inspection interval in months (default 12)';
COMMENT ON COLUMN plant.current_hours IS 'Current hour meter reading for the plant asset';
