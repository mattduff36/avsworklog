-- =============================================================================
-- PRD-EPIC-ACCOUNT-SWITCH-001
-- Windows-style device-bound PIN model for shared-device account switching.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Harden legacy table access. Account switch writes are service-role only.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view own account switch settings" ON public.account_switch_settings;
DROP POLICY IF EXISTS "Users can insert own account switch settings" ON public.account_switch_settings;
DROP POLICY IF EXISTS "Users can update own account switch settings" ON public.account_switch_settings;
DROP POLICY IF EXISTS "Users can delete own account switch settings" ON public.account_switch_settings;

CREATE POLICY "Users can view own account switch settings"
  ON public.account_switch_settings
  FOR SELECT
  TO authenticated
  USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "Users can view own account switch audit events" ON public.account_switch_audit_events;
DROP POLICY IF EXISTS "Users can insert own account switch audit events" ON public.account_switch_audit_events;

CREATE POLICY "Users can view own account switch audit events"
  ON public.account_switch_audit_events
  FOR SELECT
  TO authenticated
  USING (profile_id = auth.uid() OR actor_profile_id = auth.uid());

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
      'password_fallback_failed'
    )
  );

-- ---------------------------------------------------------------------------
-- Device registrations for shared-device PIN unlock/switch flows.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_switch_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  device_id_hash TEXT NOT NULL,
  device_label TEXT,
  trusted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (profile_id, device_id_hash),
  UNIQUE (id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_account_switch_devices_profile
  ON public.account_switch_devices (profile_id);

CREATE INDEX IF NOT EXISTS idx_account_switch_devices_profile_hash
  ON public.account_switch_devices (profile_id, device_id_hash);

DROP TRIGGER IF EXISTS set_updated_at_account_switch_devices ON public.account_switch_devices;
CREATE TRIGGER set_updated_at_account_switch_devices
  BEFORE UPDATE ON public.account_switch_devices
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Per-profile/per-device credential (PIN hash + lockout state).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_switch_device_credentials (
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES public.account_switch_devices(id) ON DELETE CASCADE,
  pin_hash TEXT NOT NULL,
  pin_failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (pin_failed_attempts >= 0),
  pin_locked_until TIMESTAMPTZ,
  pin_last_changed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (profile_id, device_id),
  FOREIGN KEY (device_id, profile_id)
    REFERENCES public.account_switch_devices(id, profile_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_account_switch_device_credentials_device
  ON public.account_switch_device_credentials (device_id);

DROP TRIGGER IF EXISTS set_updated_at_account_switch_device_credentials ON public.account_switch_device_credentials;
CREATE TRIGGER set_updated_at_account_switch_device_credentials
  BEFORE UPDATE ON public.account_switch_device_credentials
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Optional server-side session metadata per device/profile.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_switch_device_sessions (
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES public.account_switch_devices(id) ON DELETE CASCADE,
  session_registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_switch_at TIMESTAMPTZ,
  session_hint TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (profile_id, device_id),
  FOREIGN KEY (device_id, profile_id)
    REFERENCES public.account_switch_devices(id, profile_id)
    ON DELETE CASCADE
);

DROP TRIGGER IF EXISTS set_updated_at_account_switch_device_sessions ON public.account_switch_device_sessions;
CREATE TRIGGER set_updated_at_account_switch_device_sessions
  BEFORE UPDATE ON public.account_switch_device_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- RLS on new device tables.
-- ---------------------------------------------------------------------------
ALTER TABLE public.account_switch_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_switch_device_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_switch_device_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own account switch devices" ON public.account_switch_devices;
CREATE POLICY "Users can view own account switch devices"
  ON public.account_switch_devices
  FOR SELECT
  TO authenticated
  USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "Users can view own account switch device credentials" ON public.account_switch_device_credentials;
CREATE POLICY "Users can view own account switch device credentials"
  ON public.account_switch_device_credentials
  FOR SELECT
  TO authenticated
  USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "Users can view own account switch device sessions" ON public.account_switch_device_sessions;
CREATE POLICY "Users can view own account switch device sessions"
  ON public.account_switch_device_sessions
  FOR SELECT
  TO authenticated
  USING (profile_id = auth.uid());

COMMIT;
