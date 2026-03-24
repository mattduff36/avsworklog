BEGIN;

CREATE TABLE IF NOT EXISTS quote_timeline_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  quote_thread_id UUID NOT NULL,
  quote_reference VARCHAR(30) NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  from_status VARCHAR(30),
  to_status VARCHAR(30),
  actor_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE quote_timeline_events IS 'User-facing timeline history for quote actions, status changes, and related activity.';

CREATE INDEX IF NOT EXISTS idx_quote_timeline_events_thread_created_at
  ON quote_timeline_events(quote_thread_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_quote_timeline_events_quote_created_at
  ON quote_timeline_events(quote_id, created_at DESC);

ALTER TABLE quote_timeline_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quote_timeline_events_select ON quote_timeline_events;
CREATE POLICY quote_timeline_events_select ON quote_timeline_events
  FOR SELECT USING (effective_is_manager_admin());

DROP POLICY IF EXISTS quote_timeline_events_insert ON quote_timeline_events;
CREATE POLICY quote_timeline_events_insert ON quote_timeline_events
  FOR INSERT WITH CHECK (effective_is_manager_admin());

INSERT INTO quote_timeline_events (
  quote_id,
  quote_thread_id,
  quote_reference,
  event_type,
  title,
  description,
  to_status,
  actor_user_id,
  created_at
)
SELECT
  q.id,
  COALESCE(q.quote_thread_id, q.id),
  q.quote_reference,
  CASE
    WHEN q.parent_quote_id IS NULL THEN 'quote_created'
    ELSE 'version_created'
  END,
  CASE
    WHEN q.parent_quote_id IS NULL THEN 'Quote created'
    ELSE 'Version created'
  END,
  CASE
    WHEN q.parent_quote_id IS NULL THEN 'Initial quote record created.'
    ELSE COALESCE(q.version_notes, 'Quote version created.')
  END,
  q.status,
  q.created_by,
  COALESCE(q.created_at, NOW())
FROM quotes q
WHERE NOT EXISTS (
  SELECT 1
  FROM quote_timeline_events e
  WHERE e.quote_id = q.id
    AND e.event_type IN ('quote_created', 'version_created')
);

COMMIT;
