-- Migration: Update vehicle inspections schema to match app requirements
-- Run this in your Supabase SQL Editor

-- 1. Update vehicle_inspections table
ALTER TABLE vehicle_inspections 
  RENAME COLUMN week_ending TO inspection_date;

ALTER TABLE vehicle_inspections 
  DROP COLUMN IF EXISTS mileage,
  DROP COLUMN IF EXISTS checked_by,
  DROP COLUMN IF EXISTS defects_comments,
  DROP COLUMN IF EXISTS action_taken;

ALTER TABLE vehicle_inspections
  ADD COLUMN IF NOT EXISTS manager_comments TEXT;

-- Update status values
ALTER TABLE vehicle_inspections
  DROP CONSTRAINT IF EXISTS vehicle_inspections_status_check;

ALTER TABLE vehicle_inspections
  ADD CONSTRAINT vehicle_inspections_status_check 
  CHECK (status IN ('draft', 'submitted', 'approved', 'rejected'));

-- Update existing 'in_progress' to 'draft' and 'reviewed' to 'approved'
UPDATE vehicle_inspections 
SET status = 'draft' WHERE status = 'in_progress';

UPDATE vehicle_inspections 
SET status = 'approved' WHERE status = 'reviewed';

-- 2. Update inspection_items table structure
-- Drop the old table and recreate with new structure
DROP TABLE IF EXISTS inspection_items CASCADE;

CREATE TABLE inspection_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  inspection_id UUID REFERENCES vehicle_inspections(id) ON DELETE CASCADE NOT NULL,
  item_number INTEGER CHECK (item_number BETWEEN 1 AND 26) NOT NULL,
  item_description TEXT NOT NULL,
  status TEXT CHECK (status IN ('ok', 'defect')) NOT NULL DEFAULT 'ok',
  comments TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(inspection_id, item_number)
);

-- Recreate index
CREATE INDEX IF NOT EXISTS idx_inspection_items_inspection_id ON inspection_items(inspection_id);

-- Enable RLS
ALTER TABLE inspection_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies for inspection_items
CREATE POLICY "Employees can view own inspection items" ON inspection_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM vehicle_inspections vi
      WHERE vi.id = inspection_items.inspection_id
      AND vi.user_id = auth.uid()
    )
  );

CREATE POLICY "Managers can view all inspection items" ON inspection_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role IN ('manager', 'admin')
    )
  );

CREATE POLICY "Employees can insert own inspection items" ON inspection_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM vehicle_inspections vi
      WHERE vi.id = inspection_items.inspection_id
      AND vi.user_id = auth.uid()
    )
  );

CREATE POLICY "Employees can update own inspection items" ON inspection_items
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM vehicle_inspections vi
      WHERE vi.id = inspection_items.inspection_id
      AND vi.user_id = auth.uid()
      AND vi.status IN ('draft', 'rejected')
    )
  );

-- 3. Update inspection_photos day_of_week to item_number reference only
-- (No changes needed - structure is fine)

COMMENT ON TABLE vehicle_inspections IS 'Updated to support single-inspection with 26 items';
COMMENT ON TABLE inspection_items IS 'Stores individual inspection item status and comments';


