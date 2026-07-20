BEGIN;

ALTER TABLE public.inventory_kiosk_devices
  ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_phase TEXT,
  ADD COLUMN IF NOT EXISTS last_app_version TEXT,
  ADD COLUMN IF NOT EXISTS last_deployment_id TEXT,
  ADD COLUMN IF NOT EXISTS last_error_code TEXT,
  ADD COLUMN IF NOT EXISTS last_diagnostic_id TEXT,
  ADD COLUMN IF NOT EXISTS diagnostics JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.inventory_kiosk_devices
  DROP CONSTRAINT IF EXISTS inventory_kiosk_devices_last_phase_check;

ALTER TABLE public.inventory_kiosk_devices
  ADD CONSTRAINT inventory_kiosk_devices_last_phase_check
  CHECK (
    last_phase IS NULL
    OR last_phase IN ('mode', 'location', 'items', 'submitting', 'receipt', 'pairing', 'recover')
  );

CREATE TABLE IF NOT EXISTS public.inventory_kiosk_device_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL
    REFERENCES public.inventory_kiosk_devices(id) ON DELETE CASCADE,
  command_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT NOT NULL,
  issued_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  result_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventory_kiosk_device_commands_type_check
    CHECK (command_type IN (
      'ping',
      'refresh_status',
      'refresh_session',
      'reload_app',
      'reset_workflow',
      'logout',
      'clear_credentials'
    )),
  CONSTRAINT inventory_kiosk_device_commands_status_check
    CHECK (status IN (
      'pending',
      'accepted',
      'completed',
      'failed',
      'expired',
      'cancelled'
    )),
  CONSTRAINT inventory_kiosk_device_commands_idempotency_unique
    UNIQUE (device_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS inventory_kiosk_device_commands_pending_idx
  ON public.inventory_kiosk_device_commands (device_id, status, expires_at)
  WHERE status IN ('pending', 'accepted');

CREATE INDEX IF NOT EXISTS inventory_kiosk_device_commands_issued_idx
  ON public.inventory_kiosk_device_commands (device_id, issued_at DESC);

CREATE TABLE IF NOT EXISTS public.inventory_kiosk_device_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID
    REFERENCES public.inventory_kiosk_devices(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  error_code TEXT,
  diagnostic_id TEXT,
  message TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventory_kiosk_device_events_type_check
    CHECK (char_length(BTRIM(event_type)) BETWEEN 1 AND 80)
);

CREATE INDEX IF NOT EXISTS inventory_kiosk_device_events_device_created_idx
  ON public.inventory_kiosk_device_events (device_id, created_at DESC);

CREATE INDEX IF NOT EXISTS inventory_kiosk_device_events_diagnostic_idx
  ON public.inventory_kiosk_device_events (diagnostic_id)
  WHERE diagnostic_id IS NOT NULL;

DROP TRIGGER IF EXISTS set_updated_at_inventory_kiosk_device_commands
  ON public.inventory_kiosk_device_commands;
CREATE TRIGGER set_updated_at_inventory_kiosk_device_commands
  BEFORE UPDATE ON public.inventory_kiosk_device_commands
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.inventory_kiosk_device_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_kiosk_device_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users cannot access kiosk device commands directly"
  ON public.inventory_kiosk_device_commands;
CREATE POLICY "Authenticated users cannot access kiosk device commands directly"
  ON public.inventory_kiosk_device_commands
  FOR ALL
  TO authenticated
  USING (FALSE)
  WITH CHECK (FALSE);

DROP POLICY IF EXISTS "Authenticated users cannot access kiosk device events directly"
  ON public.inventory_kiosk_device_events;
CREATE POLICY "Authenticated users cannot access kiosk device events directly"
  ON public.inventory_kiosk_device_events
  FOR ALL
  TO authenticated
  USING (FALSE)
  WITH CHECK (FALSE);

COMMENT ON TABLE public.inventory_kiosk_device_commands IS
  'Audited remote recovery commands for online Yard kiosk tablets.';
COMMENT ON TABLE public.inventory_kiosk_device_events IS
  'Sanitized Yard kiosk diagnostic events for operator troubleshooting.';
COMMENT ON COLUMN public.inventory_kiosk_devices.last_heartbeat_at IS
  'Last successful authenticated heartbeat from the Yard kiosk tablet.';

COMMIT;
