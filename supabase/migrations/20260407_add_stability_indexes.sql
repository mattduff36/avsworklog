-- Stability indexes for high-frequency dashboard, notification, absence, and page-visit queries.
-- These are additive only and target the load-shedding/report remediation work.

CREATE INDEX IF NOT EXISTS idx_message_recipients_user_pending_inbox_message
  ON public.message_recipients (user_id, message_id)
  WHERE status = 'PENDING' AND cleared_from_inbox_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_page_visits_user_path_visited_at_desc
  ON public.user_page_visits (user_id, path, visited_at DESC);

CREATE INDEX IF NOT EXISTS idx_rams_assignments_employee_status
  ON public.rams_assignments (employee_id, status);

CREATE INDEX IF NOT EXISTS idx_absences_profile_date_desc
  ON public.absences (profile_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_absences_status_date_desc
  ON public.absences (status, date DESC);
