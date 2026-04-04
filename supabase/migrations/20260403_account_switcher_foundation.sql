-- =============================================================================
-- PRD-EPIC-ACCOUNT-SWITCH-001
-- Shared-device account switcher foundations:
-- 1) account_switch_settings (PIN hash + lockout state per profile)
-- 2) account_switch_audit_events (security and lifecycle event trail)
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.account_switch_settings (
  profile_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  quick_switch_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  pin_hash TEXT,
  pin_failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (pin_failed_attempts >= 0),
  pin_locked_until TIMESTAMPTZ,
  pin_last_changed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_switch_settings_quick_switch_enabled
  ON public.account_switch_settings (quick_switch_enabled);

CREATE TABLE IF NOT EXISTS public.account_switch_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  actor_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'pin_setup',
      'pin_reset',
      'pin_verify_success',
      'pin_verify_failed',
      'pin_locked',
      'session_registered',
      'session_switch_success',
      'session_switch_failed',
      'shortcut_removed'
    )
  ),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_switch_audit_events_profile_created
  ON public.account_switch_audit_events (profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_account_switch_audit_events_actor_created
  ON public.account_switch_audit_events (actor_profile_id, created_at DESC);

ALTER TABLE public.account_switch_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_switch_audit_events ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at_account_switch_settings ON public.account_switch_settings;
CREATE TRIGGER set_updated_at_account_switch_settings
  BEFORE UPDATE ON public.account_switch_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP POLICY IF EXISTS "Users can view own account switch settings" ON public.account_switch_settings;
CREATE POLICY "Users can view own account switch settings"
  ON public.account_switch_settings
  FOR SELECT
  TO authenticated
  USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own account switch settings" ON public.account_switch_settings;
CREATE POLICY "Users can insert own account switch settings"
  ON public.account_switch_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (profile_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own account switch settings" ON public.account_switch_settings;
CREATE POLICY "Users can update own account switch settings"
  ON public.account_switch_settings
  FOR UPDATE
  TO authenticated
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own account switch settings" ON public.account_switch_settings;
CREATE POLICY "Users can delete own account switch settings"
  ON public.account_switch_settings
  FOR DELETE
  TO authenticated
  USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "Users can view own account switch audit events" ON public.account_switch_audit_events;
CREATE POLICY "Users can view own account switch audit events"
  ON public.account_switch_audit_events
  FOR SELECT
  TO authenticated
  USING (profile_id = auth.uid() OR actor_profile_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own account switch audit events" ON public.account_switch_audit_events;
CREATE POLICY "Users can insert own account switch audit events"
  ON public.account_switch_audit_events
  FOR INSERT
  TO authenticated
  WITH CHECK (actor_profile_id = auth.uid());

COMMIT;
