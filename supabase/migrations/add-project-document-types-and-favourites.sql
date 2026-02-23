-- Migration: Add project_document_types and project_favourites tables
-- Also extends rams_documents with document_type_id FK
-- Part of Projects module refactor (formerly RAMS Documents)

-- 1. Create project_document_types table
CREATE TABLE IF NOT EXISTS project_document_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  required_signature BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Seed the default RAMS type
INSERT INTO project_document_types (name, description, required_signature, is_active, sort_order)
VALUES ('RAMS', 'Risk Assessment & Method Statement', TRUE, TRUE, 0)
ON CONFLICT (name) DO NOTHING;

-- 3. Add document_type_id column to rams_documents
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'rams_documents' AND column_name = 'document_type_id'
  ) THEN
    ALTER TABLE rams_documents
      ADD COLUMN document_type_id UUID REFERENCES project_document_types(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 4. Backfill existing documents to the RAMS type
UPDATE rams_documents
SET document_type_id = (
  SELECT id FROM project_document_types WHERE name = 'RAMS' LIMIT 1
)
WHERE document_type_id IS NULL;

-- 5. Create project_favourites table
CREATE TABLE IF NOT EXISTS project_favourites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id UUID NOT NULL REFERENCES rams_documents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(document_id, user_id)
);

-- 6. Indexes
CREATE INDEX IF NOT EXISTS idx_project_document_types_active
  ON project_document_types(is_active, sort_order);

CREATE INDEX IF NOT EXISTS idx_rams_documents_type
  ON rams_documents(document_type_id);

CREATE INDEX IF NOT EXISTS idx_project_favourites_user
  ON project_favourites(user_id);

CREATE INDEX IF NOT EXISTS idx_project_favourites_document
  ON project_favourites(document_id);

-- 7. Enable RLS
ALTER TABLE project_document_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_favourites ENABLE ROW LEVEL SECURITY;

-- 8. RLS policies for project_document_types

-- Everyone authenticated can read active types
CREATE POLICY "Authenticated users can view active document types"
  ON project_document_types FOR SELECT
  USING (
    is_active = TRUE
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'manager')
    )
  );

-- Managers/admins can insert
CREATE POLICY "Managers can create document types"
  ON project_document_types FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'manager')
    )
  );

-- Managers/admins can update
CREATE POLICY "Managers can update document types"
  ON project_document_types FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'manager')
    )
  );

-- Managers/admins can delete
CREATE POLICY "Managers can delete document types"
  ON project_document_types FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'manager')
    )
  );

-- 9. RLS policies for project_favourites

-- Users can view their own favourites
CREATE POLICY "Users can view own favourites"
  ON project_favourites FOR SELECT
  USING (user_id = auth.uid());

-- Managers/admins can create favourites
CREATE POLICY "Managers can create favourites"
  ON project_favourites FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'manager')
    )
  );

-- Users can delete their own favourites
CREATE POLICY "Users can delete own favourites"
  ON project_favourites FOR DELETE
  USING (user_id = auth.uid());

-- 10. Updated-at triggers
CREATE OR REPLACE FUNCTION update_project_document_types_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS project_document_types_updated_at ON project_document_types;
CREATE TRIGGER project_document_types_updated_at
  BEFORE UPDATE ON project_document_types
  FOR EACH ROW
  EXECUTE FUNCTION update_project_document_types_updated_at();
