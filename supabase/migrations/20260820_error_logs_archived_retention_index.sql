-- Support 12-month archived error_logs retention purge.
-- Additive only. CREATE INDEX CONCURRENTLY cannot run inside a transaction.
-- Apply with: npx tsx scripts/run-error-logs-archived-retention-index-migration.ts

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_error_logs_archived_at
  ON public.error_logs (archived_at)
  WHERE status = 'archived';
