-- Migration: Add DVLA API Sync Tracking
-- Description: Add fields to track automatic syncing with DVLA API
-- Date: 2025-12-22
-- Author: Lyra AI

BEGIN;

-- ============================================================================
-- Add DVLA sync tracking fields to vehicle_maintenance
-- ============================================================================

-- Add last DVLA sync timestamp
ALTER TABLE vehicle_maintenance
ADD COLUMN IF NOT EXISTS last_dvla_sync TIMESTAMP WITH TIME ZONE;

-- Add DVLA sync status
ALTER TABLE vehicle_maintenance
ADD COLUMN IF NOT EXISTS dvla_sync_status VARCHAR(20) CHECK (dvla_sync_status IN ('never', 'success', 'error', 'pending'));

-- Add DVLA sync error message
ALTER TABLE vehicle_maintenance
ADD COLUMN IF NOT EXISTS dvla_sync_error TEXT;

-- Add DVLA raw data (for debugging and audit trail)
ALTER TABLE vehicle_maintenance
ADD COLUMN IF NOT EXISTS dvla_raw_data JSONB;

-- Set default status for existing records
UPDATE vehicle_maintenance
SET dvla_sync_status = 'never'
WHERE dvla_sync_status IS NULL;

-- ============================================================================
-- Add indexes for performance
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_dvla_sync_status
  ON vehicle_maintenance(dvla_sync_status);

CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_last_dvla_sync
  ON vehicle_maintenance(last_dvla_sync DESC);

-- ============================================================================
-- Add comments
-- ============================================================================

COMMENT ON COLUMN vehicle_maintenance.last_dvla_sync IS 'Timestamp of last successful DVLA API sync';
COMMENT ON COLUMN vehicle_maintenance.dvla_sync_status IS 'Status of last DVLA API sync attempt';
COMMENT ON COLUMN vehicle_maintenance.dvla_sync_error IS 'Error message from last failed DVLA API sync';
COMMENT ON COLUMN vehicle_maintenance.dvla_raw_data IS 'Complete DVLA API response for debugging';

-- ============================================================================
-- Create DVLA sync log table for audit trail
-- ============================================================================

CREATE TABLE IF NOT EXISTS dvla_sync_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  registration_number VARCHAR(20) NOT NULL,
  
  sync_status VARCHAR(20) NOT NULL CHECK (sync_status IN ('success', 'error')),
  error_message TEXT,
  
  -- Data updated
  fields_updated TEXT[], -- Array of field names that were updated
  tax_due_date_old DATE,
  tax_due_date_new DATE,
  mot_due_date_old DATE,
  mot_due_date_new DATE,
  
  -- API details
  api_provider VARCHAR(50), -- e.g., 'vehiclesmart', 'checkcardetails'
  api_response_time_ms INTEGER,
  raw_response JSONB,
  
  -- Who triggered it
  triggered_by UUID REFERENCES profiles(id),
  trigger_type VARCHAR(20) CHECK (trigger_type IN ('manual', 'automatic', 'bulk')),
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for dvla_sync_log
CREATE INDEX IF NOT EXISTS idx_dvla_sync_log_vehicle
  ON dvla_sync_log(vehicle_id);

CREATE INDEX IF NOT EXISTS idx_dvla_sync_log_created_at
  ON dvla_sync_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dvla_sync_log_status
  ON dvla_sync_log(sync_status);

CREATE INDEX IF NOT EXISTS idx_dvla_sync_log_registration
  ON dvla_sync_log(registration_number);

-- Enable RLS
ALTER TABLE dvla_sync_log ENABLE ROW LEVEL SECURITY;

-- RLS Policy for dvla_sync_log
CREATE POLICY "Users with maintenance permission view sync log"
  ON dvla_sync_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      INNER JOIN role_permissions rp ON r.id = rp.role_id
      WHERE p.id = auth.uid()
        AND rp.module_name = 'maintenance'
        AND rp.enabled = true
    ) OR EXISTS (
      SELECT 1 FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid() 
        AND r.name IN ('admin', 'manager')
    )
  );

-- Comments
COMMENT ON TABLE dvla_sync_log IS 'Audit trail of all DVLA API sync operations';
COMMENT ON COLUMN dvla_sync_log.fields_updated IS 'Array of maintenance fields that were updated';
COMMENT ON COLUMN dvla_sync_log.trigger_type IS 'Whether sync was manual (user click), automatic (scheduled), or bulk';

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ DVLA Sync Tracking Migration Complete!';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE 'Added to vehicle_maintenance:';
  RAISE NOTICE '  ✓ last_dvla_sync (timestamp)';
  RAISE NOTICE '  ✓ dvla_sync_status (never/success/error/pending)';
  RAISE NOTICE '  ✓ dvla_sync_error (text)';
  RAISE NOTICE '  ✓ dvla_raw_data (jsonb)';
  RAISE NOTICE '';
  RAISE NOTICE 'Created new table:';
  RAISE NOTICE '  ✓ dvla_sync_log (audit trail)';
  RAISE NOTICE '';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '  1. Configure DVLA API credentials in .env.local';
  RAISE NOTICE '  2. Build API endpoints';
  RAISE NOTICE '  3. Add UI sync buttons';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '';
END $$;

COMMIT;

