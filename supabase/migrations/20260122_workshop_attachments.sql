-- Migration: Workshop Task Attachments (Service Reports / Checklists)
-- Date: 2026-01-22
-- Purpose: Add customizable attachment templates and responses for workshop tasks
-- Related: Feature 5 - Workshop Task Attachments
-- PRD: plans/feature-05-workshop-attachments.md

-- ========================================
-- PART 1: CREATE ATTACHMENT TEMPLATES TABLE
-- ========================================

CREATE TABLE IF NOT EXISTS workshop_attachment_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ
);

-- Indexes for templates
CREATE INDEX IF NOT EXISTS idx_workshop_attachment_templates_active
  ON workshop_attachment_templates(is_active)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_workshop_attachment_templates_name
  ON workshop_attachment_templates(LOWER(name));

-- ========================================
-- PART 2: CREATE ATTACHMENT QUESTIONS TABLE
-- ========================================

-- Question types enum
DO $$ BEGIN
  CREATE TYPE workshop_question_type AS ENUM ('checkbox', 'text', 'long_text', 'number', 'date');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS workshop_attachment_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES workshop_attachment_templates(id) ON DELETE CASCADE,
  question_text VARCHAR(500) NOT NULL,
  question_type workshop_question_type NOT NULL DEFAULT 'checkbox',
  is_required BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

-- Indexes for questions
CREATE INDEX IF NOT EXISTS idx_workshop_attachment_questions_template
  ON workshop_attachment_questions(template_id, sort_order);

-- ========================================
-- PART 3: CREATE TASK ATTACHMENTS TABLE (LINK)
-- ========================================

-- Attachment status enum
DO $$ BEGIN
  CREATE TYPE workshop_attachment_status AS ENUM ('pending', 'completed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS workshop_task_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES workshop_attachment_templates(id),
  status workshop_attachment_status NOT NULL DEFAULT 'pending',
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- Indexes for task attachments
CREATE INDEX IF NOT EXISTS idx_workshop_task_attachments_task
  ON workshop_task_attachments(task_id);

CREATE INDEX IF NOT EXISTS idx_workshop_task_attachments_template
  ON workshop_task_attachments(template_id);

CREATE INDEX IF NOT EXISTS idx_workshop_task_attachments_status
  ON workshop_task_attachments(status);

-- Unique constraint: one template per task
CREATE UNIQUE INDEX IF NOT EXISTS idx_workshop_task_attachments_unique
  ON workshop_task_attachments(task_id, template_id);

-- ========================================
-- PART 4: CREATE ATTACHMENT RESPONSES TABLE
-- ========================================

CREATE TABLE IF NOT EXISTS workshop_attachment_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attachment_id UUID NOT NULL REFERENCES workshop_task_attachments(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES workshop_attachment_questions(id),
  question_snapshot JSONB NOT NULL,
  response_value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

-- Indexes for responses
CREATE INDEX IF NOT EXISTS idx_workshop_attachment_responses_attachment
  ON workshop_attachment_responses(attachment_id);

CREATE INDEX IF NOT EXISTS idx_workshop_attachment_responses_question
  ON workshop_attachment_responses(question_id);

-- Unique constraint: one response per question per attachment
CREATE UNIQUE INDEX IF NOT EXISTS idx_workshop_attachment_responses_unique
  ON workshop_attachment_responses(attachment_id, question_id);

-- ========================================
-- PART 5: RLS POLICIES - TEMPLATES
-- ========================================

ALTER TABLE workshop_attachment_templates ENABLE ROW LEVEL SECURITY;

-- Read: All authenticated users can read active templates
CREATE POLICY "Authenticated users can read templates"
  ON workshop_attachment_templates
  FOR SELECT
  TO authenticated
  USING (true);

-- Create: Manager/Admin only
CREATE POLICY "Managers and admins can create templates"
  ON workshop_attachment_templates
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

-- Update: Manager/Admin only
CREATE POLICY "Managers and admins can update templates"
  ON workshop_attachment_templates
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

-- Delete: Manager/Admin only
CREATE POLICY "Managers and admins can delete templates"
  ON workshop_attachment_templates
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
-- PART 6: RLS POLICIES - QUESTIONS
-- ========================================

ALTER TABLE workshop_attachment_questions ENABLE ROW LEVEL SECURITY;

-- Read: All authenticated users can read questions
CREATE POLICY "Authenticated users can read questions"
  ON workshop_attachment_questions
  FOR SELECT
  TO authenticated
  USING (true);

-- Create: Manager/Admin only
CREATE POLICY "Managers and admins can create questions"
  ON workshop_attachment_questions
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

-- Update: Manager/Admin only
CREATE POLICY "Managers and admins can update questions"
  ON workshop_attachment_questions
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

-- Delete: Manager/Admin only
CREATE POLICY "Managers and admins can delete questions"
  ON workshop_attachment_questions
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
-- PART 7: RLS POLICIES - TASK ATTACHMENTS
-- ========================================

ALTER TABLE workshop_task_attachments ENABLE ROW LEVEL SECURITY;

-- Read: Workshop users can read attachments for workshop tasks
CREATE POLICY "Workshop users can read task attachments"
  ON workshop_task_attachments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM actions a
      WHERE a.id = workshop_task_attachments.task_id
        AND a.action_type IN ('inspection_defect', 'workshop_vehicle_task')
        AND (
          EXISTS (
            SELECT 1 
            FROM profiles p
            INNER JOIN roles r ON p.role_id = r.id
            WHERE p.id = auth.uid()
              AND r.is_manager_admin = true
          )
          OR
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

-- Create: Workshop users can create attachments
CREATE POLICY "Workshop users can create task attachments"
  ON workshop_task_attachments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM actions a
      WHERE a.id = workshop_task_attachments.task_id
        AND a.action_type IN ('inspection_defect', 'workshop_vehicle_task')
        AND (
          EXISTS (
            SELECT 1 
            FROM profiles p
            INNER JOIN roles r ON p.role_id = r.id
            WHERE p.id = auth.uid()
              AND r.is_manager_admin = true
          )
          OR
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

-- Update: Workshop users can update task attachments
CREATE POLICY "Workshop users can update task attachments"
  ON workshop_task_attachments
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM actions a
      WHERE a.id = workshop_task_attachments.task_id
        AND a.action_type IN ('inspection_defect', 'workshop_vehicle_task')
        AND (
          EXISTS (
            SELECT 1 
            FROM profiles p
            INNER JOIN roles r ON p.role_id = r.id
            WHERE p.id = auth.uid()
              AND r.is_manager_admin = true
          )
          OR
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
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM actions a
      WHERE a.id = workshop_task_attachments.task_id
        AND a.action_type IN ('inspection_defect', 'workshop_vehicle_task')
        AND (
          EXISTS (
            SELECT 1 
            FROM profiles p
            INNER JOIN roles r ON p.role_id = r.id
            WHERE p.id = auth.uid()
              AND r.is_manager_admin = true
          )
          OR
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

-- Delete: Manager/Admin only
CREATE POLICY "Managers and admins can delete task attachments"
  ON workshop_task_attachments
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
-- PART 8: RLS POLICIES - RESPONSES
-- ========================================

ALTER TABLE workshop_attachment_responses ENABLE ROW LEVEL SECURITY;

-- Read: Workshop users can read responses
CREATE POLICY "Workshop users can read attachment responses"
  ON workshop_attachment_responses
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM workshop_task_attachments wta
      INNER JOIN actions a ON a.id = wta.task_id
      WHERE wta.id = workshop_attachment_responses.attachment_id
        AND a.action_type IN ('inspection_defect', 'workshop_vehicle_task')
        AND (
          EXISTS (
            SELECT 1 
            FROM profiles p
            INNER JOIN roles r ON p.role_id = r.id
            WHERE p.id = auth.uid()
              AND r.is_manager_admin = true
          )
          OR
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

-- Create: Workshop users can create responses
CREATE POLICY "Workshop users can create attachment responses"
  ON workshop_attachment_responses
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM workshop_task_attachments wta
      INNER JOIN actions a ON a.id = wta.task_id
      WHERE wta.id = workshop_attachment_responses.attachment_id
        AND a.action_type IN ('inspection_defect', 'workshop_vehicle_task')
        AND (
          EXISTS (
            SELECT 1 
            FROM profiles p
            INNER JOIN roles r ON p.role_id = r.id
            WHERE p.id = auth.uid()
              AND r.is_manager_admin = true
          )
          OR
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

-- Update: Workshop users can update responses
CREATE POLICY "Workshop users can update attachment responses"
  ON workshop_attachment_responses
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM workshop_task_attachments wta
      INNER JOIN actions a ON a.id = wta.task_id
      WHERE wta.id = workshop_attachment_responses.attachment_id
        AND a.action_type IN ('inspection_defect', 'workshop_vehicle_task')
        AND (
          EXISTS (
            SELECT 1 
            FROM profiles p
            INNER JOIN roles r ON p.role_id = r.id
            WHERE p.id = auth.uid()
              AND r.is_manager_admin = true
          )
          OR
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
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM workshop_task_attachments wta
      INNER JOIN actions a ON a.id = wta.task_id
      WHERE wta.id = workshop_attachment_responses.attachment_id
        AND a.action_type IN ('inspection_defect', 'workshop_vehicle_task')
        AND (
          EXISTS (
            SELECT 1 
            FROM profiles p
            INNER JOIN roles r ON p.role_id = r.id
            WHERE p.id = auth.uid()
              AND r.is_manager_admin = true
          )
          OR
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

-- Delete: Manager/Admin only
CREATE POLICY "Managers and admins can delete attachment responses"
  ON workshop_attachment_responses
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
-- PART 9: UPDATED_AT TRIGGERS
-- ========================================

-- Templates updated_at trigger
CREATE OR REPLACE FUNCTION update_workshop_attachment_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_workshop_attachment_templates_updated_at
  BEFORE UPDATE ON workshop_attachment_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_workshop_attachment_templates_updated_at();

-- Questions updated_at trigger
CREATE OR REPLACE FUNCTION update_workshop_attachment_questions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_workshop_attachment_questions_updated_at
  BEFORE UPDATE ON workshop_attachment_questions
  FOR EACH ROW
  EXECUTE FUNCTION update_workshop_attachment_questions_updated_at();

-- Responses updated_at trigger
CREATE OR REPLACE FUNCTION update_workshop_attachment_responses_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_workshop_attachment_responses_updated_at
  BEFORE UPDATE ON workshop_attachment_responses
  FOR EACH ROW
  EXECUTE FUNCTION update_workshop_attachment_responses_updated_at();

-- ========================================
-- PART 10: COMMENTS AND DOCUMENTATION
-- ========================================

COMMENT ON TABLE workshop_attachment_templates IS 'Templates for workshop task attachments (e.g., Full Service Checklist, Basic Service Checklist)';
COMMENT ON COLUMN workshop_attachment_templates.name IS 'Template display name';
COMMENT ON COLUMN workshop_attachment_templates.description IS 'Optional description of the template purpose';
COMMENT ON COLUMN workshop_attachment_templates.is_active IS 'Whether this template is available for selection';

COMMENT ON TABLE workshop_attachment_questions IS 'Questions/checklist items within an attachment template';
COMMENT ON COLUMN workshop_attachment_questions.template_id IS 'Parent template';
COMMENT ON COLUMN workshop_attachment_questions.question_text IS 'The question or checklist item text';
COMMENT ON COLUMN workshop_attachment_questions.question_type IS 'Response type: checkbox, text, long_text, number, date';
COMMENT ON COLUMN workshop_attachment_questions.is_required IS 'Whether a response is required';
COMMENT ON COLUMN workshop_attachment_questions.sort_order IS 'Display order within the template';

COMMENT ON TABLE workshop_task_attachments IS 'Links attachment templates to workshop tasks';
COMMENT ON COLUMN workshop_task_attachments.task_id IS 'The workshop task (actions table)';
COMMENT ON COLUMN workshop_task_attachments.template_id IS 'The attachment template being used';
COMMENT ON COLUMN workshop_task_attachments.status IS 'pending = not yet filled, completed = all required responses submitted';

COMMENT ON TABLE workshop_attachment_responses IS 'User responses to attachment questions';
COMMENT ON COLUMN workshop_attachment_responses.attachment_id IS 'The task attachment being filled';
COMMENT ON COLUMN workshop_attachment_responses.question_id IS 'The question being answered';
COMMENT ON COLUMN workshop_attachment_responses.question_snapshot IS 'Snapshot of question text/type at time of response for historical accuracy';
COMMENT ON COLUMN workshop_attachment_responses.response_value IS 'The response value (stored as text for all types)';
