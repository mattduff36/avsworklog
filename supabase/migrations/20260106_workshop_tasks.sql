-- ========================================
-- WORKSHOP TASKS MODULE
-- Migration: Create workshop_task_categories + extend actions table
-- Created: 2026-01-06
-- PRD: docs/PRD_WORKSHOP_TASKS.md
-- ========================================

-- ========================================
-- PART 1: CREATE workshop_task_categories TABLE
-- ========================================

CREATE TABLE IF NOT EXISTS workshop_task_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  applies_to TEXT NOT NULL DEFAULT 'vehicle' CHECK (applies_to IN ('vehicle', 'plant', 'tools')),
  name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE workshop_task_categories ENABLE ROW LEVEL SECURITY;

-- RLS Policies for workshop_task_categories
-- SELECT: Any authenticated user can view categories
CREATE POLICY "Anyone can view workshop task categories" ON workshop_task_categories
  FOR SELECT
  TO authenticated
  USING (true);

-- INSERT: Only managers/admins can create categories
CREATE POLICY "Managers can create workshop task categories" ON workshop_task_categories
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

-- UPDATE: Only managers/admins can update categories
CREATE POLICY "Managers can update workshop task categories" ON workshop_task_categories
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
  );

-- DELETE: Only managers/admins can delete categories
CREATE POLICY "Managers can delete workshop task categories" ON workshop_task_categories
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

-- Create default categories
INSERT INTO workshop_task_categories (name, applies_to, is_active, sort_order)
VALUES 
  ('Uncategorised', 'vehicle', true, 0),
  ('Brakes', 'vehicle', true, 1),
  ('Engine', 'vehicle', true, 2),
  ('Electrical', 'vehicle', true, 3),
  ('Suspension & Steering', 'vehicle', true, 4),
  ('Bodywork', 'vehicle', true, 5)
ON CONFLICT DO NOTHING;

-- ========================================
-- PART 2: EXTEND actions TABLE
-- ========================================

-- Add action_type column with default and constraint
-- Default to 'manager_action' for backward compatibility with existing records
ALTER TABLE actions ADD COLUMN IF NOT EXISTS action_type TEXT NOT NULL DEFAULT 'manager_action' 
  CHECK (action_type IN ('inspection_defect', 'workshop_vehicle_task', 'manager_action'));

-- Add vehicle_id for proactive workshop tasks not tied to an inspection
ALTER TABLE actions ADD COLUMN IF NOT EXISTS vehicle_id UUID REFERENCES vehicles(id);

-- Add workshop_category_id for categorizing workshop work
ALTER TABLE actions ADD COLUMN IF NOT EXISTS workshop_category_id UUID REFERENCES workshop_task_categories(id);

-- Add workshop_comments for detailed work notes (separate from logged_comment)
ALTER TABLE actions ADD COLUMN IF NOT EXISTS workshop_comments TEXT;

-- ========================================
-- PART 3: BACKFILL EXISTING DATA
-- ========================================

-- Mark existing inspection-linked actions as inspection_defect
UPDATE actions 
SET action_type = 'inspection_defect'
WHERE inspection_id IS NOT NULL 
  AND action_type = 'manager_action';

-- Set default category for existing inspection defects (if category is null)
UPDATE actions 
SET workshop_category_id = (SELECT id FROM workshop_task_categories WHERE name = 'Uncategorised' LIMIT 1)
WHERE action_type = 'inspection_defect' 
  AND workshop_category_id IS NULL;

-- ========================================
-- PART 4: CREATE INDEXES
-- ========================================

-- Index for workshop queries (action_type + status + created_at)
CREATE INDEX IF NOT EXISTS idx_actions_action_type_status ON actions(action_type, status, created_at DESC);

-- Index for vehicle_id lookups
CREATE INDEX IF NOT EXISTS idx_actions_vehicle_id ON actions(vehicle_id) WHERE vehicle_id IS NOT NULL;

-- Index for workshop_category_id lookups
CREATE INDEX IF NOT EXISTS idx_actions_workshop_category ON actions(workshop_category_id) WHERE workshop_category_id IS NOT NULL;

-- ========================================
-- PART 5: UPDATE RLS POLICIES FOR actions
-- ========================================

-- Add new policy: Workshop users can view workshop tasks
CREATE POLICY "Workshop users can view workshop tasks" ON actions
  FOR SELECT
  TO authenticated
  USING (
    action_type IN ('inspection_defect', 'workshop_vehicle_task')
    AND EXISTS (
      SELECT 1 
      FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      INNER JOIN role_permissions rp ON r.id = rp.role_id
      WHERE p.id = auth.uid()
      AND rp.module_name = 'workshop-tasks'
      AND rp.enabled = true
    )
  );

-- Add new policy: Workshop users can update workshop tasks
CREATE POLICY "Workshop users can update workshop tasks" ON actions
  FOR UPDATE
  TO authenticated
  USING (
    action_type IN ('inspection_defect', 'workshop_vehicle_task')
    AND EXISTS (
      SELECT 1 
      FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      INNER JOIN role_permissions rp ON r.id = rp.role_id
      WHERE p.id = auth.uid()
      AND rp.module_name = 'workshop-tasks'
      AND rp.enabled = true
    )
  )
  WITH CHECK (
    -- Ensure they can only update workshop-type actions
    action_type IN ('inspection_defect', 'workshop_vehicle_task')
  );

-- Add new policy: Workshop users can insert workshop tasks
CREATE POLICY "Workshop users can create workshop tasks" ON actions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    action_type IN ('inspection_defect', 'workshop_vehicle_task')
    AND EXISTS (
      SELECT 1 
      FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      INNER JOIN role_permissions rp ON r.id = rp.role_id
      WHERE p.id = auth.uid()
      AND rp.module_name = 'workshop-tasks'
      AND rp.enabled = true
    )
  );

-- ========================================
-- PART 6: ADD ROLE PERMISSIONS FOR workshop-tasks MODULE
-- ========================================

-- Insert workshop-tasks permission for all roles
-- Enabled for managers/admins, disabled for others (can be granted explicitly)
INSERT INTO role_permissions (role_id, module_name, enabled)
SELECT 
  id, 
  'workshop-tasks', 
  is_manager_admin
FROM roles
WHERE NOT EXISTS (
  SELECT 1 
  FROM role_permissions 
  WHERE role_id = roles.id 
  AND module_name = 'workshop-tasks'
);

-- ========================================
-- PART 7: ADD COMMENTS
-- ========================================

COMMENT ON TABLE workshop_task_categories IS 'Categories for workshop tasks (vehicle, plant, tools)';
COMMENT ON COLUMN workshop_task_categories.applies_to IS 'Type of work: vehicle, plant, or tools';
COMMENT ON COLUMN workshop_task_categories.name IS 'Category name (e.g., Brakes, Engine, Electrical)';
COMMENT ON COLUMN workshop_task_categories.is_active IS 'Whether this category is currently active/selectable';
COMMENT ON COLUMN workshop_task_categories.sort_order IS 'Display order (lower numbers first)';

COMMENT ON COLUMN actions.action_type IS 'Type: inspection_defect (auto from inspections), workshop_vehicle_task (manual), or manager_action (non-workshop)';
COMMENT ON COLUMN actions.vehicle_id IS 'Direct vehicle reference for proactive tasks (inspection_defect uses inspection_id->vehicle_id)';
COMMENT ON COLUMN actions.workshop_category_id IS 'Workshop task category (nullable for uncategorized)';
COMMENT ON COLUMN actions.workshop_comments IS 'Detailed workshop notes (separate from logged_comment which is short manager note)';

