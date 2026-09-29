-- finalise-phase: predeploy
-- Additive error_logs triage lifecycle. Existing archived rows stay valid
-- when every triage column is null. Authenticated clients cannot forge
-- status or triage transitions; only the service-role finalizer may write them.

ALTER TABLE public.error_logs
  ADD COLUMN IF NOT EXISTS triage_state TEXT;

ALTER TABLE public.error_logs
  ADD COLUMN IF NOT EXISTS triaged_at TIMESTAMPTZ;

ALTER TABLE public.error_logs
  ADD COLUMN IF NOT EXISTS triage_incident_id TEXT;

ALTER TABLE public.error_logs
  ADD COLUMN IF NOT EXISTS triage_summary TEXT;

ALTER TABLE public.error_logs
  ADD COLUMN IF NOT EXISTS triage_next_step TEXT;

ALTER TABLE public.error_logs
  ADD COLUMN IF NOT EXISTS triage_local_commit TEXT;

ALTER TABLE public.error_logs
  ADD COLUMN IF NOT EXISTS triage_live_verified_at TIMESTAMPTZ;

ALTER TABLE public.error_logs
  ADD COLUMN IF NOT EXISTS triage_live_evidence JSONB;

ALTER TABLE public.error_logs
  DROP CONSTRAINT IF EXISTS error_logs_status_archived_at_consistency;

ALTER TABLE public.error_logs
  DROP CONSTRAINT IF EXISTS error_logs_lifecycle_check;

ALTER TABLE public.error_logs
  ADD CONSTRAINT error_logs_lifecycle_check
  CHECK (
    (
      status = 'active'
      AND archived_at IS NULL
      AND triage_state IS NULL
      AND triaged_at IS NULL
      AND triage_incident_id IS NULL
      AND triage_summary IS NULL
      AND triage_next_step IS NULL
      AND triage_local_commit IS NULL
      AND triage_live_verified_at IS NULL
      AND triage_live_evidence IS NULL
    )
    OR (
      status = 'active'
      AND archived_at IS NULL
      AND triage_state = 'outstanding'
      AND triaged_at IS NOT NULL
      AND triage_incident_id IS NOT NULL
      AND length(btrim(triage_incident_id)) > 0
      AND triage_summary IS NOT NULL
      AND length(btrim(triage_summary)) > 0
      AND triage_next_step IS NOT NULL
      AND length(btrim(triage_next_step)) > 0
      AND triage_live_verified_at IS NULL
      AND triage_live_evidence IS NULL
    )
    OR (
      status = 'archived'
      AND archived_at IS NOT NULL
      AND triage_state IS NULL
      AND triaged_at IS NULL
      AND triage_incident_id IS NULL
      AND triage_summary IS NULL
      AND triage_next_step IS NULL
      AND triage_local_commit IS NULL
      AND triage_live_verified_at IS NULL
      AND triage_live_evidence IS NULL
    )
    OR (
      status = 'archived'
      AND archived_at IS NOT NULL
      AND triage_state = 'no_fix_required'
      AND triaged_at IS NOT NULL
      AND triage_incident_id IS NOT NULL
      AND length(btrim(triage_incident_id)) > 0
      AND triage_summary IS NOT NULL
      AND length(btrim(triage_summary)) > 0
      AND triage_next_step IS NULL
      AND triage_local_commit IS NULL
      AND triage_live_verified_at IS NULL
      AND triage_live_evidence IS NULL
    )
    OR (
      status = 'archived'
      AND archived_at IS NOT NULL
      AND triage_state = 'fixed_live'
      AND triaged_at IS NOT NULL
      AND triage_incident_id IS NOT NULL
      AND length(btrim(triage_incident_id)) > 0
      AND triage_summary IS NOT NULL
      AND length(btrim(triage_summary)) > 0
      AND triage_next_step IS NULL
      AND triage_live_verified_at IS NOT NULL
      AND triage_live_evidence IS NOT NULL
      AND jsonb_typeof(triage_live_evidence) = 'object'
      AND length(btrim(triage_live_evidence->>'deployedCommit')) > 0
      AND length(btrim(triage_live_evidence->>'deploymentId')) > 0
      AND length(btrim(triage_live_evidence->>'check')) > 0
      AND triage_live_evidence->>'result' = 'passed'
    )
  );

DROP POLICY IF EXISTS "SuperAdmin can update error logs" ON public.error_logs;

CREATE INDEX IF NOT EXISTS idx_error_logs_untriaged_created_at
  ON public.error_logs (created_at DESC, id DESC)
  WHERE status = 'active' AND triage_state IS NULL;

COMMENT ON COLUMN public.error_logs.triage_state IS
  'Null means untriaged while active, or a legacy archive. outstanding stays active. no_fix_required and fixed_live are archived.';
COMMENT ON COLUMN public.error_logs.triage_live_evidence IS
  'Structured deployed-commit, deployment, check, and passed result. A local commit never satisfies fixed_live.';
