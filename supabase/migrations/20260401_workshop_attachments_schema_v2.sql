-- Migration: Workshop Attachments Schema V2
-- Date: 2026-04-01
-- Purpose: Add section-based template versions, immutable attachment snapshots, and structured responses
-- Notes: Backward compatible with existing workshop_attachment_questions/responses flow

-- ========================================
-- PART 1: ENUMS
-- ========================================

DO $$ BEGIN
  CREATE TYPE workshop_attachment_template_version_status AS ENUM ('draft', 'published', 'archived');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE workshop_attachment_field_type AS ENUM (
    'marking_code',
    'text',
    'long_text',
    'number',
    'date',
    'yes_no',
    'signature'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ========================================
-- PART 2: TEMPLATE VERSIONING TABLES
-- ========================================

CREATE TABLE IF NOT EXISTS workshop_attachment_template_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES workshop_attachment_templates(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  status workshop_attachment_template_version_status NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ,
  UNIQUE (template_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_workshop_attachment_template_versions_template
  ON workshop_attachment_template_versions(template_id, version_number DESC);

CREATE INDEX IF NOT EXISTS idx_workshop_attachment_template_versions_status
  ON workshop_attachment_template_versions(status);

CREATE TABLE IF NOT EXISTS workshop_attachment_template_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id UUID NOT NULL REFERENCES workshop_attachment_template_versions(id) ON DELETE CASCADE,
  section_key VARCHAR(120) NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (version_id, section_key)
);

CREATE INDEX IF NOT EXISTS idx_workshop_attachment_template_sections_version
  ON workshop_attachment_template_sections(version_id, sort_order);

CREATE TABLE IF NOT EXISTS workshop_attachment_template_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id UUID NOT NULL REFERENCES workshop_attachment_template_sections(id) ON DELETE CASCADE,
  field_key VARCHAR(120) NOT NULL,
  label VARCHAR(500) NOT NULL,
  help_text TEXT,
  field_type workshop_attachment_field_type NOT NULL,
  is_required BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  options_json JSONB,
  validation_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (section_id, field_key)
);

CREATE INDEX IF NOT EXISTS idx_workshop_attachment_template_fields_section
  ON workshop_attachment_template_fields(section_id, sort_order);

-- ========================================
-- PART 3: ATTACHMENT SNAPSHOT + RESPONSES
-- ========================================

CREATE TABLE IF NOT EXISTS workshop_attachment_schema_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attachment_id UUID NOT NULL UNIQUE REFERENCES workshop_task_attachments(id) ON DELETE CASCADE,
  template_version_id UUID REFERENCES workshop_attachment_template_versions(id),
  snapshot_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_workshop_attachment_schema_snapshots_attachment
  ON workshop_attachment_schema_snapshots(attachment_id);

CREATE TABLE IF NOT EXISTS workshop_attachment_field_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attachment_id UUID NOT NULL REFERENCES workshop_task_attachments(id) ON DELETE CASCADE,
  field_id UUID REFERENCES workshop_attachment_template_fields(id) ON DELETE SET NULL,
  section_key VARCHAR(120) NOT NULL,
  field_key VARCHAR(120) NOT NULL,
  response_value TEXT,
  response_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (attachment_id, section_key, field_key)
);

CREATE INDEX IF NOT EXISTS idx_workshop_attachment_field_responses_attachment
  ON workshop_attachment_field_responses(attachment_id);

-- ========================================
-- PART 4: RLS
-- ========================================

ALTER TABLE workshop_attachment_template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workshop_attachment_template_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE workshop_attachment_template_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE workshop_attachment_schema_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE workshop_attachment_field_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read template versions" ON workshop_attachment_template_versions;
DROP POLICY IF EXISTS "Managers and admins can create template versions" ON workshop_attachment_template_versions;
DROP POLICY IF EXISTS "Managers and admins can update template versions" ON workshop_attachment_template_versions;
DROP POLICY IF EXISTS "Managers and admins can delete template versions" ON workshop_attachment_template_versions;
DROP POLICY IF EXISTS "Authenticated users can read template sections" ON workshop_attachment_template_sections;
DROP POLICY IF EXISTS "Managers and admins can manage template sections" ON workshop_attachment_template_sections;
DROP POLICY IF EXISTS "Authenticated users can read template fields" ON workshop_attachment_template_fields;
DROP POLICY IF EXISTS "Managers and admins can manage template fields" ON workshop_attachment_template_fields;
DROP POLICY IF EXISTS "Workshop users can read schema snapshots" ON workshop_attachment_schema_snapshots;
DROP POLICY IF EXISTS "Workshop users can create schema snapshots" ON workshop_attachment_schema_snapshots;
DROP POLICY IF EXISTS "Workshop users can read field responses v2" ON workshop_attachment_field_responses;
DROP POLICY IF EXISTS "Workshop users can create field responses v2" ON workshop_attachment_field_responses;
DROP POLICY IF EXISTS "Workshop users can update field responses v2" ON workshop_attachment_field_responses;

-- Template versions: read for authenticated, write for manager/admin
CREATE POLICY "Authenticated users can read template versions"
  ON workshop_attachment_template_versions
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Managers and admins can create template versions"
  ON workshop_attachment_template_versions
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

CREATE POLICY "Managers and admins can update template versions"
  ON workshop_attachment_template_versions
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

CREATE POLICY "Managers and admins can delete template versions"
  ON workshop_attachment_template_versions
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

-- Sections
CREATE POLICY "Authenticated users can read template sections"
  ON workshop_attachment_template_sections
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Managers and admins can manage template sections"
  ON workshop_attachment_template_sections
  FOR ALL
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

-- Fields
CREATE POLICY "Authenticated users can read template fields"
  ON workshop_attachment_template_fields
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Managers and admins can manage template fields"
  ON workshop_attachment_template_fields
  FOR ALL
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

-- Snapshot and responses: workshop users with workshop-task access
CREATE POLICY "Workshop users can read schema snapshots"
  ON workshop_attachment_schema_snapshots
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM workshop_task_attachments wta
      INNER JOIN actions a ON a.id = wta.task_id
      WHERE wta.id = workshop_attachment_schema_snapshots.attachment_id
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

CREATE POLICY "Workshop users can create schema snapshots"
  ON workshop_attachment_schema_snapshots
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM workshop_task_attachments wta
      INNER JOIN actions a ON a.id = wta.task_id
      WHERE wta.id = workshop_attachment_schema_snapshots.attachment_id
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

CREATE POLICY "Workshop users can read field responses v2"
  ON workshop_attachment_field_responses
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM workshop_task_attachments wta
      INNER JOIN actions a ON a.id = wta.task_id
      WHERE wta.id = workshop_attachment_field_responses.attachment_id
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

CREATE POLICY "Workshop users can create field responses v2"
  ON workshop_attachment_field_responses
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM workshop_task_attachments wta
      INNER JOIN actions a ON a.id = wta.task_id
      WHERE wta.id = workshop_attachment_field_responses.attachment_id
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

CREATE POLICY "Workshop users can update field responses v2"
  ON workshop_attachment_field_responses
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM workshop_task_attachments wta
      INNER JOIN actions a ON a.id = wta.task_id
      WHERE wta.id = workshop_attachment_field_responses.attachment_id
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
      WHERE wta.id = workshop_attachment_field_responses.attachment_id
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

-- ========================================
-- PART 5: UPDATED_AT TRIGGERS
-- ========================================

CREATE OR REPLACE FUNCTION update_workshop_attachment_template_versions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_workshop_attachment_template_versions_updated_at ON workshop_attachment_template_versions;
CREATE TRIGGER set_workshop_attachment_template_versions_updated_at
  BEFORE UPDATE ON workshop_attachment_template_versions
  FOR EACH ROW
  EXECUTE FUNCTION update_workshop_attachment_template_versions_updated_at();

CREATE OR REPLACE FUNCTION update_workshop_attachment_field_responses_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_workshop_attachment_field_responses_updated_at ON workshop_attachment_field_responses;
CREATE TRIGGER set_workshop_attachment_field_responses_updated_at
  BEFORE UPDATE ON workshop_attachment_field_responses
  FOR EACH ROW
  EXECUTE FUNCTION update_workshop_attachment_field_responses_updated_at();

-- ========================================
-- PART 6: COMMENTS
-- ========================================

COMMENT ON TABLE workshop_attachment_template_versions IS 'Version history for section-based workshop attachment schemas';
COMMENT ON TABLE workshop_attachment_template_sections IS 'Ordered sections for a template version';
COMMENT ON TABLE workshop_attachment_template_fields IS 'Ordered fields for each schema section';
COMMENT ON TABLE workshop_attachment_schema_snapshots IS 'Immutable schema snapshot captured when template is attached to a task';
COMMENT ON TABLE workshop_attachment_field_responses IS 'Field-level responses for schema v2 attachments';
