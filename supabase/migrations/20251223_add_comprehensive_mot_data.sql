-- Comprehensive MOT History API Data Storage
-- Based on GOV.UK MOT History API specification
-- https://documentation.history.mot.api.gov.uk/mot-history-api/api-specification/

-- ============================================================================
-- VEHICLE-LEVEL MOT DATA (stored in vehicle_maintenance table)
-- ============================================================================

-- Add comprehensive vehicle data from MOT History API
ALTER TABLE vehicle_maintenance
-- API sync tracking
ADD COLUMN IF NOT EXISTS mot_expiry_date DATE,
ADD COLUMN IF NOT EXISTS mot_api_sync_status TEXT CHECK (mot_api_sync_status IN ('never', 'success', 'error', 'pending')),
ADD COLUMN IF NOT EXISTS mot_api_sync_error TEXT,
ADD COLUMN IF NOT EXISTS last_mot_api_sync TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS mot_raw_data JSONB,
-- Vehicle data from MOT History API
ADD COLUMN IF NOT EXISTS mot_make TEXT,
ADD COLUMN IF NOT EXISTS mot_model TEXT,
ADD COLUMN IF NOT EXISTS mot_first_used_date DATE,
ADD COLUMN IF NOT EXISTS mot_registration_date DATE,
ADD COLUMN IF NOT EXISTS mot_manufacture_date DATE,
ADD COLUMN IF NOT EXISTS mot_engine_size TEXT,
ADD COLUMN IF NOT EXISTS mot_fuel_type TEXT,
ADD COLUMN IF NOT EXISTS mot_primary_colour TEXT,
ADD COLUMN IF NOT EXISTS mot_secondary_colour TEXT,
ADD COLUMN IF NOT EXISTS mot_vehicle_id TEXT, -- DVSA internal ID
ADD COLUMN IF NOT EXISTS mot_registration TEXT, -- VRN from MOT system
ADD COLUMN IF NOT EXISTS mot_vin TEXT, -- Vehicle Identification Number
ADD COLUMN IF NOT EXISTS mot_v5c_reference TEXT, -- V5C reference number
ADD COLUMN IF NOT EXISTS mot_dvla_id TEXT; -- DVLA ID

-- Indexes for MOT vehicle data
CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_mot_model ON vehicle_maintenance(mot_model);
CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_mot_vehicle_id ON vehicle_maintenance(mot_vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_mot_expiry_date ON vehicle_maintenance(mot_expiry_date);
CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_last_mot_api_sync ON vehicle_maintenance(last_mot_api_sync);

-- Comments for MOT API sync tracking fields
COMMENT ON COLUMN vehicle_maintenance.mot_expiry_date IS 'MOT expiry date from MOT History API';
COMMENT ON COLUMN vehicle_maintenance.mot_api_sync_status IS 'Status of last MOT API sync (never, success, error, pending)';
COMMENT ON COLUMN vehicle_maintenance.mot_api_sync_error IS 'Error message from last failed MOT API sync';
COMMENT ON COLUMN vehicle_maintenance.last_mot_api_sync IS 'Timestamp of last MOT API sync attempt';
COMMENT ON COLUMN vehicle_maintenance.mot_raw_data IS 'Raw JSON response from MOT History API';

-- Comments for MOT vehicle fields
COMMENT ON COLUMN vehicle_maintenance.mot_make IS 'Vehicle make from MOT History API';
COMMENT ON COLUMN vehicle_maintenance.mot_model IS 'Vehicle model from MOT History API';
COMMENT ON COLUMN vehicle_maintenance.mot_first_used_date IS 'Date of first use from MOT History API';
COMMENT ON COLUMN vehicle_maintenance.mot_registration_date IS 'Registration date from MOT History API';
COMMENT ON COLUMN vehicle_maintenance.mot_manufacture_date IS 'Manufacturing date from MOT History API';
COMMENT ON COLUMN vehicle_maintenance.mot_engine_size IS 'Engine size (cc) from MOT History API';
COMMENT ON COLUMN vehicle_maintenance.mot_fuel_type IS 'Fuel type from MOT History API';
COMMENT ON COLUMN vehicle_maintenance.mot_primary_colour IS 'Primary colour from MOT History API';
COMMENT ON COLUMN vehicle_maintenance.mot_secondary_colour IS 'Secondary colour from MOT History API';
COMMENT ON COLUMN vehicle_maintenance.mot_vehicle_id IS 'DVSA vehicle ID from MOT History API';
COMMENT ON COLUMN vehicle_maintenance.mot_registration IS 'VRN as recorded in MOT system';
COMMENT ON COLUMN vehicle_maintenance.mot_vin IS 'Vehicle Identification Number from MOT History API';
COMMENT ON COLUMN vehicle_maintenance.mot_v5c_reference IS 'V5C reference number from MOT History API';
COMMENT ON COLUMN vehicle_maintenance.mot_dvla_id IS 'DVLA ID from MOT History API';

-- ============================================================================
-- MOT TEST HISTORY TABLE (stores complete test history)
-- ============================================================================

CREATE TABLE IF NOT EXISTS mot_test_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  
  -- Test identification
  mot_test_number TEXT NOT NULL UNIQUE,
  completed_date TIMESTAMPTZ NOT NULL,
  test_result TEXT NOT NULL, -- 'PASSED', 'FAILED', etc.
  
  -- MOT expiry (only for passed tests)
  expiry_date DATE,
  
  -- Odometer reading
  odometer_value INTEGER,
  odometer_unit TEXT, -- 'mi' or 'km'
  odometer_result_type TEXT, -- 'READ', 'NOT_READABLE', 'NO_ODOMETER'
  
  -- Test details
  test_class TEXT, -- e.g., '4', '5', '7'
  test_type TEXT, -- e.g., 'NORMAL', 'RETEST', 'PARTIAL_RETEST'
  cylinder_capacity INTEGER, -- Engine size at time of test
  
  -- Location
  test_station_number TEXT,
  test_station_name TEXT,
  test_station_pcode TEXT,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for MOT test history
CREATE INDEX IF NOT EXISTS idx_mot_test_history_vehicle_id ON mot_test_history(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_mot_test_history_completed_date ON mot_test_history(completed_date DESC);
CREATE INDEX IF NOT EXISTS idx_mot_test_history_test_result ON mot_test_history(test_result);
CREATE INDEX IF NOT EXISTS idx_mot_test_history_expiry_date ON mot_test_history(expiry_date);
CREATE INDEX IF NOT EXISTS idx_mot_test_history_mot_test_number ON mot_test_history(mot_test_number);

-- Comments
COMMENT ON TABLE mot_test_history IS 'Complete MOT test history from GOV.UK MOT History API';
COMMENT ON COLUMN mot_test_history.mot_test_number IS 'Unique MOT test number';
COMMENT ON COLUMN mot_test_history.test_result IS 'Test result: PASSED, FAILED, etc.';
COMMENT ON COLUMN mot_test_history.expiry_date IS 'MOT expiry date (only for passed tests)';
COMMENT ON COLUMN mot_test_history.odometer_value IS 'Odometer reading at test time';
COMMENT ON COLUMN mot_test_history.test_class IS 'MOT test class (e.g., 4 for cars, 7 for vans)';

-- ============================================================================
-- MOT TEST DEFECTS TABLE (stores advisory items and failures)
-- ============================================================================

CREATE TABLE IF NOT EXISTS mot_test_defects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  mot_test_id UUID NOT NULL REFERENCES mot_test_history(id) ON DELETE CASCADE,
  
  -- Defect details
  type TEXT NOT NULL, -- 'ADVISORY', 'MINOR', 'MAJOR', 'DANGEROUS', 'PRS', 'FAIL'
  text TEXT NOT NULL, -- Description of the defect
  location_lateral TEXT, -- e.g., 'nearside', 'offside', 'front', 'rear'
  location_longitudinal TEXT,
  location_vertical TEXT,
  
  -- Classification
  dangerous BOOLEAN DEFAULT FALSE,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for MOT defects
CREATE INDEX IF NOT EXISTS idx_mot_test_defects_mot_test_id ON mot_test_defects(mot_test_id);
CREATE INDEX IF NOT EXISTS idx_mot_test_defects_type ON mot_test_defects(type);
CREATE INDEX IF NOT EXISTS idx_mot_test_defects_dangerous ON mot_test_defects(dangerous) WHERE dangerous = true;

-- Comments
COMMENT ON TABLE mot_test_defects IS 'MOT test defects, advisories, and failure items from MOT History API';
COMMENT ON COLUMN mot_test_defects.type IS 'Defect severity: ADVISORY, MINOR, MAJOR, DANGEROUS, PRS, FAIL';
COMMENT ON COLUMN mot_test_defects.text IS 'Defect description';
COMMENT ON COLUMN mot_test_defects.dangerous IS 'Whether defect is dangerous';

-- ============================================================================
-- MOT COMMENTS TABLE (stores tester comments)
-- ============================================================================

CREATE TABLE IF NOT EXISTS mot_test_comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  mot_test_id UUID NOT NULL REFERENCES mot_test_history(id) ON DELETE CASCADE,
  
  -- Comment details
  comment_text TEXT NOT NULL,
  comment_type TEXT, -- Type of comment if categorized
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_mot_test_comments_mot_test_id ON mot_test_comments(mot_test_id);

-- Comments
COMMENT ON TABLE mot_test_comments IS 'MOT test comments from testers';

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Enable RLS
ALTER TABLE mot_test_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE mot_test_defects ENABLE ROW LEVEL SECURITY;
ALTER TABLE mot_test_comments ENABLE ROW LEVEL SECURITY;

-- Policies for mot_test_history
DROP POLICY IF EXISTS "Users can view MOT history for vehicles they can access" ON mot_test_history;
CREATE POLICY "Users can view MOT history for vehicles they can access"
  ON mot_test_history FOR SELECT
  USING (
    vehicle_id IN (
      SELECT id FROM vehicles
      -- Add your vehicle access logic here
    )
  );

DROP POLICY IF EXISTS "Service role has full access to MOT history" ON mot_test_history;
CREATE POLICY "Service role has full access to MOT history"
  ON mot_test_history FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- Policies for mot_test_defects
DROP POLICY IF EXISTS "Users can view MOT defects for tests they can access" ON mot_test_defects;
CREATE POLICY "Users can view MOT defects for tests they can access"
  ON mot_test_defects FOR SELECT
  USING (
    mot_test_id IN (
      SELECT id FROM mot_test_history
      WHERE vehicle_id IN (SELECT id FROM vehicles)
    )
  );

DROP POLICY IF EXISTS "Service role has full access to MOT defects" ON mot_test_defects;
CREATE POLICY "Service role has full access to MOT defects"
  ON mot_test_defects FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- Policies for mot_test_comments
DROP POLICY IF EXISTS "Users can view MOT comments for tests they can access" ON mot_test_comments;
CREATE POLICY "Users can view MOT comments for tests they can access"
  ON mot_test_comments FOR SELECT
  USING (
    mot_test_id IN (
      SELECT id FROM mot_test_history
      WHERE vehicle_id IN (SELECT id FROM vehicles)
    )
  );

DROP POLICY IF EXISTS "Service role has full access to MOT comments" ON mot_test_comments;
CREATE POLICY "Service role has full access to MOT comments"
  ON mot_test_comments FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Function to get latest MOT test for a vehicle
CREATE OR REPLACE FUNCTION get_latest_mot_test(p_vehicle_id UUID)
RETURNS mot_test_history AS $$
  SELECT *
  FROM mot_test_history
  WHERE vehicle_id = p_vehicle_id
  ORDER BY completed_date DESC
  LIMIT 1;
$$ LANGUAGE SQL STABLE;

-- Function to get latest passed MOT test (with expiry date)
CREATE OR REPLACE FUNCTION get_latest_passed_mot(p_vehicle_id UUID)
RETURNS mot_test_history AS $$
  SELECT *
  FROM mot_test_history
  WHERE vehicle_id = p_vehicle_id
    AND test_result = 'PASSED'
    AND expiry_date IS NOT NULL
  ORDER BY completed_date DESC
  LIMIT 1;
$$ LANGUAGE SQL STABLE;

-- Function to count defects by type for a test
CREATE OR REPLACE FUNCTION count_mot_defects_by_type(p_mot_test_id UUID)
RETURNS TABLE(defect_type TEXT, count BIGINT) AS $$
  SELECT type, COUNT(*)
  FROM mot_test_defects
  WHERE mot_test_id = p_mot_test_id
  GROUP BY type
  ORDER BY 
    CASE type
      WHEN 'DANGEROUS' THEN 1
      WHEN 'MAJOR' THEN 2
      WHEN 'MINOR' THEN 3
      WHEN 'ADVISORY' THEN 4
      ELSE 5
    END;
$$ LANGUAGE SQL STABLE;

