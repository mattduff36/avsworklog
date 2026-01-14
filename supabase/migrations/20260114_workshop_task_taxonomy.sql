-- Migration: Workshop Task Types Taxonomy (2-tier: Categories + Subcategories)
-- Date: 2026-01-14
-- Purpose: Add subcategories to workshop tasks, repurpose existing categories as top-level
-- Related: Feature 3 - Workshop Task Types Taxonomy
-- PRD: docs/PRD_WORKSHOP_TASKS.md (FR-5: Category Management)

-- ========================================
-- PART 1: ENHANCE CATEGORIES TABLE (TOP-LEVEL)
-- ========================================

-- Add metadata columns to existing workshop_task_categories
ALTER TABLE workshop_task_categories
  ADD COLUMN IF NOT EXISTS slug VARCHAR(50),
  ADD COLUMN IF NOT EXISTS ui_color VARCHAR(20),
  ADD COLUMN IF NOT EXISTS ui_icon VARCHAR(50),
  ADD COLUMN IF NOT EXISTS ui_badge_style VARCHAR(20);

-- Add unique constraint on slug per applies_to
CREATE UNIQUE INDEX IF NOT EXISTS idx_workshop_task_categories_slug_applies_to
  ON workshop_task_categories(applies_to, LOWER(slug))
  WHERE slug IS NOT NULL;

-- ========================================
-- PART 2: CREATE SUBCATEGORIES TABLE
-- ========================================

CREATE TABLE IF NOT EXISTS workshop_task_subcategories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES workshop_task_categories(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(50) NOT NULL,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  ui_color VARCHAR(20),
  ui_icon VARCHAR(50),
  ui_badge_style VARCHAR(20),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ
);

-- Indexes for subcategories
CREATE INDEX IF NOT EXISTS idx_workshop_task_subcategories_category
  ON workshop_task_subcategories(category_id);

CREATE INDEX IF NOT EXISTS idx_workshop_task_subcategories_active
  ON workshop_task_subcategories(is_active)
  WHERE is_active = true;

-- Unique constraint on slug per category
CREATE UNIQUE INDEX IF NOT EXISTS idx_workshop_task_subcategories_slug_category
  ON workshop_task_subcategories(category_id, LOWER(slug));

-- ========================================
-- PART 3: ADD SUBCATEGORY FK TO ACTIONS
-- ========================================

-- Add subcategory_id to actions table
ALTER TABLE actions
  ADD COLUMN IF NOT EXISTS workshop_subcategory_id UUID REFERENCES workshop_task_subcategories(id);

-- Index for subcategory lookups
CREATE INDEX IF NOT EXISTS idx_actions_workshop_subcategory
  ON actions(workshop_subcategory_id)
  WHERE workshop_subcategory_id IS NOT NULL;

-- ========================================
-- PART 4: RLS POLICIES FOR SUBCATEGORIES
-- ========================================

-- Enable RLS
ALTER TABLE workshop_task_subcategories ENABLE ROW LEVEL SECURITY;

-- Read policy: All authenticated users can read subcategories
CREATE POLICY "Authenticated users can read subcategories"
  ON workshop_task_subcategories
  FOR SELECT
  TO authenticated
  USING (true);

-- Create policy: Manager/Admin only
CREATE POLICY "Managers and admins can create subcategories"
  ON workshop_task_subcategories
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 
      FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
        AND r.is_manager_admin = true
    )
  );

-- Update policy: Manager/Admin only
CREATE POLICY "Managers and admins can update subcategories"
  ON workshop_task_subcategories
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
        AND r.is_manager_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 
      FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
        AND r.is_manager_admin = true
    )
  );

-- Delete policy: Manager/Admin only
CREATE POLICY "Managers and admins can delete subcategories"
  ON workshop_task_subcategories
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
        AND r.is_manager_admin = true
    )
  );

-- ========================================
-- PART 5: TRIGGER TO SYNC CATEGORY_ID FROM SUBCATEGORY
-- ========================================

-- Function to sync workshop_category_id when workshop_subcategory_id changes
CREATE OR REPLACE FUNCTION sync_workshop_category_from_subcategory()
RETURNS TRIGGER AS $$
BEGIN
  -- If workshop_subcategory_id is set, sync workshop_category_id
  IF NEW.workshop_subcategory_id IS NOT NULL THEN
    SELECT category_id INTO NEW.workshop_category_id
    FROM workshop_task_subcategories
    WHERE id = NEW.workshop_subcategory_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger to actions table
DROP TRIGGER IF EXISTS sync_workshop_category_trigger ON actions;
CREATE TRIGGER sync_workshop_category_trigger
  BEFORE INSERT OR UPDATE OF workshop_subcategory_id ON actions
  FOR EACH ROW
  EXECUTE FUNCTION sync_workshop_category_from_subcategory();

-- ========================================
-- PART 6: UPDATED_AT TRIGGER FOR SUBCATEGORIES
-- ========================================

-- Create trigger function for updated_at
CREATE OR REPLACE FUNCTION update_workshop_task_subcategories_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger
CREATE TRIGGER set_workshop_task_subcategories_updated_at
  BEFORE UPDATE ON workshop_task_subcategories
  FOR EACH ROW
  EXECUTE FUNCTION update_workshop_task_subcategories_updated_at();

-- ========================================
-- PART 7: SEED TOP-LEVEL CATEGORIES
-- ========================================

-- Note: This section will be run by the migration runner script
-- to avoid issues with existing data and to handle backfilling

-- Categories to seed:
-- 1. Service (slug: service)
-- 2. Repair (slug: repair)
-- 3. Modification (slug: modification)
-- 4. Other (slug: other)

-- Existing categories (Brakes, Engine, etc.) will be converted to subcategories under "Repair"
-- Existing "Uncategorised" will become a subcategory under "Other"

-- ========================================
-- PART 8: COMMENTS AND DOCUMENTATION
-- ========================================

COMMENT ON TABLE workshop_task_subcategories IS 'Subcategories for workshop tasks (Brakes, Engine, etc. under parent categories like Repair, Service)';
COMMENT ON COLUMN workshop_task_subcategories.category_id IS 'Parent category (e.g., Repair, Service, Modification, Other)';
COMMENT ON COLUMN workshop_task_subcategories.name IS 'Subcategory display name (e.g., Brakes, Engine)';
COMMENT ON COLUMN workshop_task_subcategories.slug IS 'URL-safe identifier';
COMMENT ON COLUMN workshop_task_subcategories.ui_color IS 'Optional UI color for badges (e.g., "blue", "#3b82f6")';
COMMENT ON COLUMN workshop_task_subcategories.ui_icon IS 'Optional icon identifier for UI';
COMMENT ON COLUMN workshop_task_subcategories.ui_badge_style IS 'Optional badge styling preset';

COMMENT ON COLUMN workshop_task_categories.slug IS 'URL-safe identifier for top-level category';
COMMENT ON COLUMN workshop_task_categories.ui_color IS 'Optional UI color for category badges';
COMMENT ON COLUMN workshop_task_categories.ui_icon IS 'Optional icon identifier for UI';
COMMENT ON COLUMN workshop_task_categories.ui_badge_style IS 'Optional badge styling preset';

COMMENT ON COLUMN actions.workshop_subcategory_id IS 'Subcategory for workshop tasks (auto-syncs workshop_category_id via trigger)';
