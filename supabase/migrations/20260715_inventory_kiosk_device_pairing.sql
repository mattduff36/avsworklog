BEGIN;

CREATE TABLE IF NOT EXISTS public.inventory_kiosk_pairing_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kiosk_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  device_label TEXT NOT NULL,
  confirmation_code TEXT,
  pairing_token_hash TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  started_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  candidate_seen_at TIMESTAMPTZ,
  confirmed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventory_kiosk_pairing_sessions_label_check
    CHECK (char_length(BTRIM(device_label)) BETWEEN 1 AND 100),
  CONSTRAINT inventory_kiosk_pairing_sessions_code_check
    CHECK (confirmation_code IS NULL OR confirmation_code ~ '^[0-9]{6}$'),
  CONSTRAINT inventory_kiosk_pairing_sessions_status_check
    CHECK (status IN ('active', 'confirmed', 'consumed', 'cancelled', 'expired'))
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_kiosk_pairing_one_active_idx
  ON public.inventory_kiosk_pairing_sessions ((1))
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS inventory_kiosk_pairing_status_expiry_idx
  ON public.inventory_kiosk_pairing_sessions (status, expires_at DESC);

CREATE TABLE IF NOT EXISTS public.inventory_kiosk_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kiosk_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  device_token_hash TEXT NOT NULL UNIQUE,
  device_label TEXT NOT NULL,
  paired_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  pairing_session_id UUID UNIQUE
    REFERENCES public.inventory_kiosk_pairing_sessions(id) ON DELETE SET NULL,
  last_seen_at TIMESTAMPTZ,
  last_authenticated_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventory_kiosk_devices_label_check
    CHECK (char_length(BTRIM(device_label)) BETWEEN 1 AND 100)
);

CREATE INDEX IF NOT EXISTS inventory_kiosk_devices_active_idx
  ON public.inventory_kiosk_devices (kiosk_user_id, last_seen_at DESC)
  WHERE revoked_at IS NULL;

ALTER TABLE public.app_auth_sessions
  ADD COLUMN IF NOT EXISTS kiosk_device_id UUID
  REFERENCES public.inventory_kiosk_devices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS app_auth_sessions_kiosk_device_active_idx
  ON public.app_auth_sessions (kiosk_device_id, revoked_at)
  WHERE kiosk_device_id IS NOT NULL;

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.app_auth_sessions'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%session_source%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.app_auth_sessions DROP CONSTRAINT IF EXISTS %I',
      constraint_name
    );
  END LOOP;

  ALTER TABLE public.app_auth_sessions
    ADD CONSTRAINT check__app_auth_sessions__session_source
    CHECK (
      session_source IN (
        'password_login',
        'session_bootstrap',
        'biometric_login',
        'kiosk_device'
      )
    );
END $$;

DROP TRIGGER IF EXISTS set_updated_at_inventory_kiosk_pairing_sessions
  ON public.inventory_kiosk_pairing_sessions;
CREATE TRIGGER set_updated_at_inventory_kiosk_pairing_sessions
  BEFORE UPDATE ON public.inventory_kiosk_pairing_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at_inventory_kiosk_devices
  ON public.inventory_kiosk_devices;
CREATE TRIGGER set_updated_at_inventory_kiosk_devices
  BEFORE UPDATE ON public.inventory_kiosk_devices
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.inventory_kiosk_pairing_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_kiosk_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users cannot access kiosk pairing sessions directly"
  ON public.inventory_kiosk_pairing_sessions;
CREATE POLICY "Authenticated users cannot access kiosk pairing sessions directly"
  ON public.inventory_kiosk_pairing_sessions
  FOR ALL
  TO authenticated
  USING (FALSE)
  WITH CHECK (FALSE);

DROP POLICY IF EXISTS "Authenticated users cannot access kiosk devices directly"
  ON public.inventory_kiosk_devices;
CREATE POLICY "Authenticated users cannot access kiosk devices directly"
  ON public.inventory_kiosk_devices
  FOR ALL
  TO authenticated
  USING (FALSE)
  WITH CHECK (FALSE);

COMMENT ON TABLE public.inventory_kiosk_pairing_sessions IS
  'Short-lived manager-approved pairing windows for Yard kiosk browser installations.';
COMMENT ON TABLE public.inventory_kiosk_devices IS
  'Revocable trusted browser credentials for automatic Yard kiosk authentication.';
COMMENT ON COLUMN public.app_auth_sessions.kiosk_device_id IS
  'Trusted Yard kiosk browser that issued this automatic app session.';

COMMIT;
