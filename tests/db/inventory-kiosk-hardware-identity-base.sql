CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END
$$;

CREATE TABLE public.inventory_kiosk_config (
  id INTEGER PRIMARY KEY,
  kiosk_user_id UUID NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE public.inventory_kiosk_pairing_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kiosk_user_id UUID NOT NULL,
  pairing_token_hash TEXT,
  confirmation_code TEXT,
  device_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  candidate_seen_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  replaces_device_id UUID,
  confirmed_by UUID,
  confirmed_at TIMESTAMPTZ
);

CREATE TABLE public.inventory_kiosk_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kiosk_user_id UUID NOT NULL,
  device_token_hash TEXT NOT NULL,
  device_label TEXT NOT NULL,
  paired_by UUID,
  pairing_session_id UUID UNIQUE
    REFERENCES public.inventory_kiosk_pairing_sessions(id),
  last_seen_at TIMESTAMPTZ,
  supersedes_device_id UUID,
  superseded_by_device_id UUID,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID,
  revoked_reason TEXT,
  control_holder_user_id UUID,
  control_session_id UUID,
  control_acquired_at TIMESTAMPTZ,
  control_lease_expires_at TIMESTAMPTZ
);

ALTER TABLE public.inventory_kiosk_pairing_sessions
  ADD CONSTRAINT inventory_kiosk_pairing_replaces_device_fk
  FOREIGN KEY (replaces_device_id)
  REFERENCES public.inventory_kiosk_devices(id);

CREATE UNIQUE INDEX inventory_kiosk_devices_one_active_idx
  ON public.inventory_kiosk_devices ((TRUE))
  WHERE revoked_at IS NULL;

CREATE TABLE public.app_auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kiosk_device_id UUID REFERENCES public.inventory_kiosk_devices(id),
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT
);

CREATE TABLE public.inventory_kiosk_device_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES public.inventory_kiosk_devices(id),
  status TEXT NOT NULL
);

CREATE TABLE public.inventory_kiosk_device_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES public.inventory_kiosk_devices(id),
  event_type TEXT NOT NULL,
  message TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE OR REPLACE FUNCTION public.inventory_kiosk_execute_unallocated_take(
  p_actor UUID,
  p_serialized_item_ids UUID[],
  p_hardware_lines JSONB,
  p_location_details TEXT,
  p_note TEXT
)
RETURNS TABLE(
  kiosk_batch_id UUID,
  movement_batch_id UUID,
  hardware_batch_id UUID,
  reminder_action_id UUID,
  serialized_count INTEGER,
  hardware_line_count INTEGER
)
LANGUAGE sql
AS $$
  SELECT
    gen_random_uuid(),
    gen_random_uuid(),
    gen_random_uuid(),
    gen_random_uuid(),
    COALESCE(array_length(p_serialized_item_ids, 1), 0),
    COALESCE(jsonb_array_length(p_hardware_lines), 0);
$$;

CREATE OR REPLACE FUNCTION public.inventory_kiosk_execute_transfer_basket(
  p_actor UUID,
  p_direction TEXT,
  p_counterpart_location_id UUID,
  p_serialized_item_ids UUID[],
  p_hardware_lines JSONB,
  p_note TEXT
)
RETURNS TABLE(
  kiosk_batch_id UUID,
  movement_batch_id UUID,
  hardware_batch_id UUID,
  serialized_count INTEGER,
  hardware_line_count INTEGER
)
LANGUAGE sql
AS $$
  SELECT
    gen_random_uuid(),
    gen_random_uuid(),
    gen_random_uuid(),
    COALESCE(array_length(p_serialized_item_ids, 1), 0),
    COALESCE(jsonb_array_length(p_hardware_lines), 0);
$$;
