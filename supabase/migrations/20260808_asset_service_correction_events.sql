-- Allow audited correction events alongside one completion event per task.
-- Completions remain unique; corrections append with the same task_id.

ALTER TABLE public.asset_service_events
  DROP CONSTRAINT IF EXISTS asset_service_events_task_unique;

ALTER TABLE public.asset_service_events
  ADD COLUMN IF NOT EXISTS corrects_event_id UUID NULL
    REFERENCES public.asset_service_events(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS asset_service_events_one_completion_per_task
  ON public.asset_service_events (task_id)
  WHERE event_type = 'completion';

CREATE INDEX IF NOT EXISTS idx_asset_service_events_task_created
  ON public.asset_service_events (task_id, created_at DESC);
