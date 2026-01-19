-- Migration: Add responsibility/duty settings to maintenance categories
-- Description: Extends maintenance_categories to support office vs workshop duties and reminder settings
-- Date: 2026-01-19
-- Author: Lyra AI (approved by Matt)
-- PRD: Fleet admin-duty workflow plan

-- This migration adds:
-- - responsibility field (workshop | office) to determine CTA type
-- - show_on_overview field to toggle visibility in Overdue/Due Soon sections
-- - reminder settings (in_app_enabled, email_enabled)
-- - maintenance_category_recipients join table for reminder recipients

BEGIN;

-- ============================================================================
-- STEP 1: Add new columns to maintenance_categories
-- ============================================================================

-- Add responsibility column (defaults to 'workshop' for backwards compatibility)
ALTER TABLE maintenance_categories
ADD COLUMN IF NOT EXISTS responsibility VARCHAR(20) DEFAULT 'workshop' 
CHECK (responsibility IN ('workshop', 'office'));

-- Add show_on_overview column (defaults to true for backwards compatibility)
ALTER TABLE maintenance_categories
ADD COLUMN IF NOT EXISTS show_on_overview BOOLEAN DEFAULT TRUE;

-- Add reminder settings columns
ALTER TABLE maintenance_categories
ADD COLUMN IF NOT EXISTS reminder_in_app_enabled BOOLEAN DEFAULT FALSE;

ALTER TABLE maintenance_categories
ADD COLUMN IF NOT EXISTS reminder_email_enabled BOOLEAN DEFAULT FALSE;

-- Comments for new columns
COMMENT ON COLUMN maintenance_categories.responsibility IS 'Who owns this maintenance type: workshop (Create Task) or office (Office Action)';
COMMENT ON COLUMN maintenance_categories.show_on_overview IS 'Whether to show this category in Overdue/Due Soon overview sections';
COMMENT ON COLUMN maintenance_categories.reminder_in_app_enabled IS 'Whether to send in-app notifications for this category';
COMMENT ON COLUMN maintenance_categories.reminder_email_enabled IS 'Whether to send email notifications for this category';

-- ============================================================================
-- STEP 2: Create maintenance_category_recipients join table
-- ============================================================================

CREATE TABLE IF NOT EXISTS maintenance_category_recipients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id UUID NOT NULL REFERENCES maintenance_categories(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Ensure no duplicate assignments
  CONSTRAINT unique_category_recipient UNIQUE(category_id, user_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_maintenance_category_recipients_category 
  ON maintenance_category_recipients(category_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_category_recipients_user 
  ON maintenance_category_recipients(user_id);

-- Comments
COMMENT ON TABLE maintenance_category_recipients IS 'Join table linking maintenance categories to users who should receive reminders';
COMMENT ON COLUMN maintenance_category_recipients.category_id IS 'Reference to the maintenance category';
COMMENT ON COLUMN maintenance_category_recipients.user_id IS 'Reference to the user profile who should receive reminders';

-- ============================================================================
-- STEP 3: RLS Policies for maintenance_category_recipients
-- ============================================================================

-- Enable RLS
ALTER TABLE maintenance_category_recipients ENABLE ROW LEVEL SECURITY;

-- Allow read access for authenticated users
CREATE POLICY "maintenance_category_recipients_select" 
  ON maintenance_category_recipients FOR SELECT 
  TO authenticated
  USING (true);

-- Allow insert/update/delete for managers and admins only
CREATE POLICY "maintenance_category_recipients_insert" 
  ON maintenance_category_recipients FOR INSERT 
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
      AND (r.name = 'admin' OR r.name = 'manager' OR r.is_manager_admin = true)
    )
  );

CREATE POLICY "maintenance_category_recipients_update" 
  ON maintenance_category_recipients FOR UPDATE 
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
      AND (r.name = 'admin' OR r.name = 'manager' OR r.is_manager_admin = true)
    )
  );

CREATE POLICY "maintenance_category_recipients_delete" 
  ON maintenance_category_recipients FOR DELETE 
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
      AND (r.name = 'admin' OR r.name = 'manager' OR r.is_manager_admin = true)
    )
  );

-- ============================================================================
-- STEP 4: Seed defaults for existing categories
-- ============================================================================

-- Update Tax Due Date to be an office responsibility with reminders enabled
UPDATE maintenance_categories 
SET 
  responsibility = 'office',
  show_on_overview = TRUE,
  reminder_in_app_enabled = TRUE,
  reminder_email_enabled = TRUE
WHERE LOWER(name) = 'tax due date';

-- Update MOT Due Date - usually handled by workshop taking vehicle to test center
-- but office needs to track paperwork, so we'll set it as workshop by default
UPDATE maintenance_categories 
SET 
  responsibility = 'workshop',
  show_on_overview = TRUE,
  reminder_in_app_enabled = FALSE,
  reminder_email_enabled = FALSE
WHERE LOWER(name) = 'mot due date';

-- Service Due - workshop responsibility
UPDATE maintenance_categories 
SET 
  responsibility = 'workshop',
  show_on_overview = TRUE,
  reminder_in_app_enabled = FALSE,
  reminder_email_enabled = FALSE
WHERE LOWER(name) = 'service due';

-- Cambelt Replacement - workshop responsibility
UPDATE maintenance_categories 
SET 
  responsibility = 'workshop',
  show_on_overview = TRUE,
  reminder_in_app_enabled = FALSE,
  reminder_email_enabled = FALSE
WHERE LOWER(name) = 'cambelt replacement';

-- First Aid Kit Expiry - could be either, default to workshop but could be changed
UPDATE maintenance_categories 
SET 
  responsibility = 'workshop',
  show_on_overview = TRUE,
  reminder_in_app_enabled = FALSE,
  reminder_email_enabled = FALSE
WHERE LOWER(name) = 'first aid kit expiry';

-- ============================================================================
-- STEP 5: Create index for responsibility filtering
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_maintenance_categories_responsibility 
  ON maintenance_categories(responsibility);

CREATE INDEX IF NOT EXISTS idx_maintenance_categories_show_on_overview 
  ON maintenance_categories(show_on_overview) WHERE show_on_overview = TRUE;

COMMIT;
