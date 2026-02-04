-- =============================================================================
-- Inspection Daily Hours Table
-- =============================================================================
-- This migration creates a table to store daily hours readings for plant
-- inspections. Each inspection can have up to 7 rows (Mon-Sun) recording
-- hours worked per day.
-- =============================================================================

-- =============================================================================
-- Create inspection_daily_hours Table
-- =============================================================================

CREATE TABLE IF NOT EXISTS inspection_daily_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Link to the inspection
  inspection_id UUID NOT NULL REFERENCES vehicle_inspections(id) ON DELETE CASCADE,
  
  -- Day of week: 1=Monday, 2=Tuesday, ..., 7=Sunday
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  
  -- Hours worked that day (can be NULL if no hours recorded)
  hours INTEGER NULL CHECK (hours >= 0 AND hours <= 24),
  
  -- Audit fields
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Ensure one entry per inspection per day
  UNIQUE(inspection_id, day_of_week)
);

-- Indexes
CREATE INDEX idx_inspection_daily_hours_inspection_id ON inspection_daily_hours(inspection_id);

-- Updated at trigger
CREATE OR REPLACE FUNCTION update_inspection_daily_hours_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER inspection_daily_hours_updated_at_trigger
BEFORE UPDATE ON inspection_daily_hours
FOR EACH ROW
EXECUTE FUNCTION update_inspection_daily_hours_updated_at();

-- =============================================================================
-- RLS Policies (mirroring inspection_items patterns)
-- =============================================================================

-- Enable RLS
ALTER TABLE inspection_daily_hours ENABLE ROW LEVEL SECURITY;

-- ============================================
-- SELECT POLICIES (View)
-- ============================================

-- Employees can view daily hours for their own inspections
CREATE POLICY "Employees can view own inspection daily hours" ON inspection_daily_hours
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM vehicle_inspections vi
      WHERE vi.id = inspection_daily_hours.inspection_id
      AND vi.user_id = auth.uid()
    )
  );

-- Managers can view all inspection daily hours
CREATE POLICY "Managers can view all inspection daily hours" ON inspection_daily_hours
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid() AND r.is_manager_admin = true
    )
  );

-- ============================================
-- INSERT POLICIES (Create)
-- ============================================

-- Employees can insert daily hours for their own inspections only
CREATE POLICY "Employees can insert own inspection daily hours" ON inspection_daily_hours
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM vehicle_inspections vi
      WHERE vi.id = inspection_daily_hours.inspection_id
      AND vi.user_id = auth.uid()
    )
  );

-- Managers can insert daily hours for any inspection
CREATE POLICY "Managers can insert all inspection daily hours" ON inspection_daily_hours
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid() AND r.is_manager_admin = true
    )
  );

-- ============================================
-- UPDATE POLICIES (Edit)
-- ============================================

-- Employees can update daily hours in their own draft inspections
CREATE POLICY "Employees can update own inspection daily hours" ON inspection_daily_hours
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM vehicle_inspections vi
      WHERE vi.id = inspection_daily_hours.inspection_id
      AND vi.user_id = auth.uid()
      AND vi.status = 'draft'
    )
  );

-- Managers can update any inspection daily hours
CREATE POLICY "Managers can update all inspection daily hours" ON inspection_daily_hours
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid() AND r.is_manager_admin = true
    )
  );

-- ============================================
-- DELETE POLICIES (Remove)
-- ============================================

-- Employees can delete daily hours from their own draft inspections
CREATE POLICY "Employees can delete own inspection daily hours" ON inspection_daily_hours
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM vehicle_inspections vi
      WHERE vi.id = inspection_daily_hours.inspection_id
      AND vi.user_id = auth.uid()
      AND vi.status = 'draft'
    )
  );

-- Managers can delete any inspection daily hours
CREATE POLICY "Managers can delete all inspection daily hours" ON inspection_daily_hours
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid() AND r.is_manager_admin = true
    )
  );

-- =============================================================================
-- Comments
-- =============================================================================

COMMENT ON TABLE inspection_daily_hours IS 'Daily hours readings for plant inspections (Mon-Sun)';
COMMENT ON COLUMN inspection_daily_hours.inspection_id IS 'Reference to the parent inspection';
COMMENT ON COLUMN inspection_daily_hours.day_of_week IS 'Day of week: 1=Monday, 2=Tuesday, ..., 7=Sunday';
COMMENT ON COLUMN inspection_daily_hours.hours IS 'Hours worked on this day (0-24)';

-- =============================================================================
-- Verification
-- =============================================================================

-- Notify completion
DO $$
BEGIN
  RAISE NOTICE 'inspection_daily_hours table created with RLS policies';
  RAISE NOTICE 'Employees can manage daily hours for their own inspections';
  RAISE NOTICE 'Managers can manage daily hours for all inspections';
END $$;
