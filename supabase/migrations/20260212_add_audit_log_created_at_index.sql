-- Migration: Add performance index on audit_log.created_at
-- Fixes: "canceling statement due to statement timeout" when fetching audit logs
-- The debug page queries: ORDER BY created_at DESC LIMIT N
-- Without this index, Postgres does a full table scan + sort.

-- Index for ORDER BY created_at DESC queries (primary fix)
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
  ON audit_log (created_at DESC);

-- Index for the JOIN to profiles via user_id (speeds up the foreign key lookup)
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id
  ON audit_log (user_id);
