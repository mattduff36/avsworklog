BEGIN;

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS scope TEXT,
  ADD COLUMN IF NOT EXISTS estimated_duration_days INTEGER,
  ADD COLUMN IF NOT EXISTS pricing_mode VARCHAR(30) NOT NULL DEFAULT 'itemized';

ALTER TABLE quotes
  DROP CONSTRAINT IF EXISTS quotes_estimated_duration_days_check,
  ADD CONSTRAINT quotes_estimated_duration_days_check
  CHECK (estimated_duration_days IS NULL OR estimated_duration_days >= 0);

ALTER TABLE quotes
  DROP CONSTRAINT IF EXISTS quotes_pricing_mode_check,
  ADD CONSTRAINT quotes_pricing_mode_check
  CHECK (pricing_mode IN ('itemized', 'attachments_only'));

ALTER TABLE quote_attachments
  ADD COLUMN IF NOT EXISTS is_client_visible BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS attachment_purpose VARCHAR(40) NOT NULL DEFAULT 'internal';

ALTER TABLE quote_attachments
  DROP CONSTRAINT IF EXISTS quote_attachments_attachment_purpose_check,
  ADD CONSTRAINT quote_attachments_attachment_purpose_check
  CHECK (attachment_purpose IN ('internal', 'client_pricing', 'client_supporting'));

ALTER TABLE rams_documents
  ADD COLUMN IF NOT EXISTS quote_id UUID REFERENCES quotes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_quotes_estimated_duration ON quotes(start_date, estimated_duration_days)
  WHERE start_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quotes_pricing_mode ON quotes(pricing_mode);
CREATE INDEX IF NOT EXISTS idx_quote_attachments_client_visible ON quote_attachments(quote_id, is_client_visible)
  WHERE is_client_visible = TRUE;
CREATE INDEX IF NOT EXISTS idx_rams_documents_quote_id ON rams_documents(quote_id)
  WHERE quote_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS work_calendar_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID REFERENCES quotes(id) ON DELETE SET NULL,
  title VARCHAR(255) NOT NULL,
  summary TEXT,
  start_date DATE NOT NULL,
  estimated_duration_days INTEGER NOT NULL DEFAULT 1,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT work_calendar_entries_duration_check CHECK (estimated_duration_days >= 0)
);

COMMENT ON TABLE work_calendar_entries IS 'Manual work calendar entries shown alongside quote start dates.';

CREATE INDEX IF NOT EXISTS idx_work_calendar_entries_start_date ON work_calendar_entries(start_date);
CREATE INDEX IF NOT EXISTS idx_work_calendar_entries_quote_id ON work_calendar_entries(quote_id)
  WHERE quote_id IS NOT NULL;

CREATE OR REPLACE FUNCTION update_work_calendar_entries_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS work_calendar_entries_updated_at_trigger ON work_calendar_entries;
CREATE TRIGGER work_calendar_entries_updated_at_trigger
BEFORE UPDATE ON work_calendar_entries
FOR EACH ROW EXECUTE FUNCTION update_work_calendar_entries_updated_at();

ALTER TABLE work_calendar_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS work_calendar_entries_select ON work_calendar_entries;
CREATE POLICY work_calendar_entries_select ON work_calendar_entries
  FOR SELECT
  TO authenticated
  USING ((SELECT effective_has_module_permission('quotes')));

DROP POLICY IF EXISTS work_calendar_entries_insert ON work_calendar_entries;
CREATE POLICY work_calendar_entries_insert ON work_calendar_entries
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT effective_has_module_permission('quotes')));

DROP POLICY IF EXISTS work_calendar_entries_update ON work_calendar_entries;
CREATE POLICY work_calendar_entries_update ON work_calendar_entries
  FOR UPDATE
  TO authenticated
  USING ((SELECT effective_has_module_permission('quotes')))
  WITH CHECK ((SELECT effective_has_module_permission('quotes')));

DROP POLICY IF EXISTS work_calendar_entries_delete ON work_calendar_entries;
CREATE POLICY work_calendar_entries_delete ON work_calendar_entries
  FOR DELETE
  TO authenticated
  USING ((SELECT effective_has_module_permission('quotes')));

COMMIT;
