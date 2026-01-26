-- ============================================================================
-- Sync Notification Preferences - Ensure All Fields Explicitly Set
-- ============================================================================
-- This migration ensures all existing notification_preferences records have
-- both notify_in_app and notify_email explicitly set to their current values
-- or defaults if somehow null.
--
-- Created: 2026-01-26
-- Purpose: Fix any partial records that may have been created with old logic
-- ============================================================================

-- Update all existing records to ensure both fields are explicitly set
-- This is idempotent and safe to run multiple times
UPDATE notification_preferences
SET 
  notify_in_app = COALESCE(notify_in_app, true),
  notify_email = COALESCE(notify_email, true),
  updated_at = NOW()
WHERE 
  notify_in_app IS NULL 
  OR notify_email IS NULL;

-- Log the number of records updated
DO $$
DECLARE
  updated_count INTEGER;
BEGIN
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RAISE NOTICE 'Updated % notification preference records to ensure both fields are set', updated_count;
END $$;

-- ============================================================================
-- Verification Query (optional - can be run separately to verify)
-- ============================================================================
-- SELECT 
--   COUNT(*) as total_records,
--   COUNT(*) FILTER (WHERE notify_in_app IS NULL) as null_in_app,
--   COUNT(*) FILTER (WHERE notify_email IS NULL) as null_email,
--   COUNT(*) FILTER (WHERE notify_in_app = true AND notify_email = true) as both_enabled,
--   COUNT(*) FILTER (WHERE notify_in_app = false OR notify_email = false) as some_disabled
-- FROM notification_preferences;

-- ============================================================================
-- End of migration
-- ============================================================================
