-- Codebase performance indexes
-- Supports latest-inspection lookups and hot paginated list endpoints.

CREATE INDEX IF NOT EXISTS idx_hgv_inspections_hgv_id_inspection_date_desc
  ON hgv_inspections(hgv_id, inspection_date DESC);

CREATE INDEX IF NOT EXISTS idx_plant_inspections_plant_id_inspection_date_desc
  ON plant_inspections(plant_id, inspection_date DESC);

CREATE INDEX IF NOT EXISTS idx_suggestions_status_created_at_desc
  ON suggestions(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_suggestions_created_by_created_at_desc
  ON suggestions(created_by, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_quotes_is_latest_version_created_at_desc
  ON quotes(is_latest_version, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_quotes_customer_id_is_latest_version_created_at_desc
  ON quotes(customer_id, is_latest_version, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_error_reports_created_by_created_at_desc
  ON error_reports(created_by, created_at DESC);
