-- =============================================================================
-- PRD-EPIC-ACCOUNT-SWITCH-001
-- Server-owned app sessions for account lock/unlock/switch flows.
-- =============================================================================

BEGIN;

ALTER TABLE public.account_switch_devices
  ADD COLUMN IF NOT EXISTS last_authenticated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_locked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_account_switch_devices_hash_active
  ON public.account_switch_devices (device_id_hash)
  WHERE revoked_at IS NULL;

ALTER TABLE public.account_switch_audit_events
  DROP CONSTRAINT IF EXISTS account_switch_audit_events_event_type_check;

ALTER TABLE public.account_switch_audit_events
  ADD CONSTRAINT account_switch_audit_events_event_type_check
  CHECK (
    event_type IN (
      'pin_setup',
      'pin_reset',
      'pin_verify_success',
      'pin_verify_failed',
      'pin_locked',
      'session_registered',
      'session_switch_success',
      'session_switch_failed',
      'shortcut_removed',
      'device_registered',
      'device_revoked',
      'password_fallback_success',
      'password_fallback_failed',
      'app_session_created',
      'app_session_locked',
      'app_session_unlocked',
      'app_session_revoked',
      'device_pin_cleared'
    )
  );

CREATE TABLE IF NOT EXISTS public.app_auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  device_id UUID REFERENCES public.account_switch_devices(id) ON DELETE SET NULL,
  session_secret_hash TEXT NOT NULL,
  session_source TEXT NOT NULL CHECK (
    session_source IN ('password_login', 'pin_unlock', 'session_bootstrap')
  ),
  remember_me BOOLEAN NOT NULL DEFAULT FALSE,
  locked_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  idle_expires_at TIMESTAMPTZ NOT NULL,
  absolute_expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT,
  replaced_by_session_id UUID REFERENCES public.app_auth_sessions(id) ON DELETE SET NULL,
  user_agent TEXT,
  ip_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_auth_sessions_profile_active
  ON public.app_auth_sessions (profile_id, revoked_at);

CREATE INDEX IF NOT EXISTS idx_app_auth_sessions_device_active
  ON public.app_auth_sessions (device_id, revoked_at);

CREATE INDEX IF NOT EXISTS idx_app_auth_sessions_absolute_expires_at
  ON public.app_auth_sessions (absolute_expires_at);

DROP TRIGGER IF EXISTS set_updated_at_app_auth_sessions ON public.app_auth_sessions;
CREATE TRIGGER set_updated_at_app_auth_sessions
  BEFORE UPDATE ON public.app_auth_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.app_auth_sessions ENABLE ROW LEVEL SECURITY;

DROP TABLE IF EXISTS public.account_switch_device_sessions;

ALTER TABLE public.account_switch_settings
  DROP COLUMN IF EXISTS pin_hash,
  DROP COLUMN IF EXISTS pin_failed_attempts,
  DROP COLUMN IF EXISTS pin_locked_until,
  DROP COLUMN IF EXISTS pin_last_changed_at;

COMMIT;
