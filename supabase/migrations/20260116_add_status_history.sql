-- Migration: Add status_history to actions for full timeline
-- Date: 2026-01-16
-- Purpose: Track repeated status transitions (on hold/resume/undo)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'actions'
      AND column_name = 'status_history'
  ) THEN
    ALTER TABLE actions
      ADD COLUMN status_history JSONB DEFAULT '[]'::jsonb;
  END IF;
END $$;

-- Backfill status_history for existing tasks (only if empty)
UPDATE actions
SET status_history = (
  SELECT COALESCE(jsonb_agg(event_item), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'id', 'status:logged:' || actions.id,
      'type', 'status',
      'status', CASE WHEN actions.status = 'on_hold' THEN 'on_hold' ELSE 'logged' END,
      'created_at', actions.logged_at,
      'author_id', actions.logged_by,
      'author_name', (SELECT full_name FROM profiles WHERE id = actions.logged_by),
      'body', COALESCE(
        actions.logged_comment,
        CASE WHEN actions.status = 'on_hold' THEN 'Placed on hold' ELSE 'Marked as in progress' END
      )
    ) AS event_item
    WHERE actions.logged_at IS NOT NULL AND actions.logged_by IS NOT NULL

    UNION ALL

    SELECT jsonb_build_object(
      'id', 'status:completed:' || actions.id,
      'type', 'status',
      'status', 'completed',
      'created_at', actions.actioned_at,
      'author_id', actions.actioned_by,
      'author_name', (SELECT full_name FROM profiles WHERE id = actions.actioned_by),
      'body', COALESCE(actions.actioned_comment, 'Marked as complete')
    ) AS event_item
    WHERE actions.actioned_at IS NOT NULL AND actions.actioned_by IS NOT NULL
  ) AS events
)
WHERE status_history IS NULL OR jsonb_array_length(status_history) = 0;
