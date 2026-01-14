-- Migration: Workshop Task Comments Timeline
-- Date: 2026-01-14
-- Purpose: Add support for multiple comments per workshop task (freeform timeline notes)
-- Related: Feature 1 - Workshop Task Comments Timeline
-- PRD: docs/PRD_WORKSHOP_TASKS.md (extends status workflow + comments)

-- ========================================
-- PART 1: CREATE COMMENTS TABLE
-- ========================================

CREATE TABLE IF NOT EXISTS workshop_task_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES auth.users(id),
  body TEXT NOT NULL CHECK (char_length(body) >= 1 AND char_length(body) <= 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

-- ========================================
-- PART 2: INDEXES
-- ========================================

-- Composite index for timeline queries (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_workshop_task_comments_task_created 
  ON workshop_task_comments(task_id, created_at DESC);

-- Index for author filtering and audits
CREATE INDEX IF NOT EXISTS idx_workshop_task_comments_author 
  ON workshop_task_comments(author_id);

-- ========================================
-- PART 3: RLS POLICIES
-- ========================================

-- Enable RLS
ALTER TABLE workshop_task_comments ENABLE ROW LEVEL SECURITY;

-- Read policy: Users with workshop-tasks permission can read comments for workshop tasks
CREATE POLICY "Workshop users can read comments for workshop tasks"
  ON workshop_task_comments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM actions a
      WHERE a.id = workshop_task_comments.task_id
        AND a.action_type IN ('inspection_defect', 'workshop_vehicle_task')
        AND (
          -- Managers/admins always have access
          EXISTS (
            SELECT 1 
            FROM profiles p
            INNER JOIN roles r ON p.role_id = r.id
            WHERE p.id = auth.uid()
              AND r.is_manager_admin = true
          )
          OR
          -- Users with workshop-tasks module permission
          EXISTS (
            SELECT 1 
            FROM profiles p
            INNER JOIN role_permissions rp ON p.role_id = rp.role_id
            WHERE p.id = auth.uid()
              AND rp.module_name = 'workshop-tasks'
              AND rp.enabled = true
          )
        )
    )
  );

-- Create policy: Workshop users can create comments if author_id = auth.uid()
CREATE POLICY "Workshop users can create own comments"
  ON workshop_task_comments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM actions a
      WHERE a.id = workshop_task_comments.task_id
        AND a.action_type IN ('inspection_defect', 'workshop_vehicle_task')
        AND (
          -- Managers/admins always have access
          EXISTS (
            SELECT 1 
            FROM profiles p
            INNER JOIN roles r ON p.role_id = r.id
            WHERE p.id = auth.uid()
              AND r.is_manager_admin = true
          )
          OR
          -- Users with workshop-tasks module permission
          EXISTS (
            SELECT 1 
            FROM profiles p
            INNER JOIN role_permissions rp ON p.role_id = rp.role_id
            WHERE p.id = auth.uid()
              AND rp.module_name = 'workshop-tasks'
              AND rp.enabled = true
          )
        )
    )
  );

-- Update policy: Comment author or manager/admin can update
CREATE POLICY "Authors and managers can update comments"
  ON workshop_task_comments
  FOR UPDATE
  TO authenticated
  USING (
    author_id = auth.uid()
    OR EXISTS (
      SELECT 1 
      FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
        AND r.is_manager_admin = true
    )
  )
  WITH CHECK (
    author_id = auth.uid()
    OR EXISTS (
      SELECT 1 
      FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
        AND r.is_manager_admin = true
    )
  );

-- Delete policy: Comment author or manager/admin can delete
CREATE POLICY "Authors and managers can delete comments"
  ON workshop_task_comments
  FOR DELETE
  TO authenticated
  USING (
    author_id = auth.uid()
    OR EXISTS (
      SELECT 1 
      FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
        AND r.is_manager_admin = true
    )
  );

-- ========================================
-- PART 4: UPDATED_AT TRIGGER
-- ========================================

-- Create trigger function for updated_at
CREATE OR REPLACE FUNCTION update_workshop_task_comments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger
CREATE TRIGGER set_workshop_task_comments_updated_at
  BEFORE UPDATE ON workshop_task_comments
  FOR EACH ROW
  EXECUTE FUNCTION update_workshop_task_comments_updated_at();

-- ========================================
-- PART 5: COMMENTS AND DOCUMENTATION
-- ========================================

COMMENT ON TABLE workshop_task_comments IS 'Multi-note timeline for workshop tasks (extends single-note logged_comment/actioned_comment)';
COMMENT ON COLUMN workshop_task_comments.task_id IS 'Foreign key to actions table (workshop tasks only)';
COMMENT ON COLUMN workshop_task_comments.author_id IS 'User who created this comment';
COMMENT ON COLUMN workshop_task_comments.body IS 'Comment text (1-1000 chars)';
COMMENT ON COLUMN workshop_task_comments.created_at IS 'When this comment was created';
COMMENT ON COLUMN workshop_task_comments.updated_at IS 'When this comment was last edited (null if never edited)';
