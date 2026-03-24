-- Admin performance indexes
-- Supports batched "latest inspection per van" lookups and filtered error-report lists.

CREATE INDEX IF NOT EXISTS idx_van_inspections_van_id_inspection_date_desc
  ON van_inspections(van_id, inspection_date DESC);

CREATE INDEX IF NOT EXISTS idx_error_reports_status_created_at_desc
  ON error_reports(status, created_at DESC);
