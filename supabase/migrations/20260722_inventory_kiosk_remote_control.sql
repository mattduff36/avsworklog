BEGIN;

ALTER TABLE public.inventory_kiosk_devices
  ADD COLUMN IF NOT EXISTS revoked_reason TEXT,
  ADD COLUMN IF NOT EXISTS superseded_by_device_id UUID
    REFERENCES public.inventory_kiosk_devices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS supersedes_device_id UUID
    REFERENCES public.inventory_kiosk_devices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_workflow_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS workflow_state_version BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_snapshot_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS control_holder_user_id UUID
    REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS control_session_id UUID,
  ADD COLUMN IF NOT EXISTS control_acquired_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS control_lease_expires_at TIMESTAMPTZ;

ALTER TABLE public.inventory_kiosk_pairing_sessions
  ADD COLUMN IF NOT EXISTS replaces_device_id UUID
    REFERENCES public.inventory_kiosk_devices(id) ON DELETE SET NULL;

ALTER TABLE public.inventory_kiosk_devices
  DROP CONSTRAINT IF EXISTS inventory_kiosk_devices_revoked_reason_check;

ALTER TABLE public.inventory_kiosk_devices
  ADD CONSTRAINT inventory_kiosk_devices_revoked_reason_check
  CHECK (
    revoked_reason IS NULL
    OR revoked_reason IN (
      'manager_revoked',
      'replaced_by_pairing',
      'migration_dedupe'
    )
  );

ALTER TABLE public.inventory_kiosk_device_commands
  DROP CONSTRAINT IF EXISTS inventory_kiosk_device_commands_type_check;

ALTER TABLE public.inventory_kiosk_device_commands
  ADD CONSTRAINT inventory_kiosk_device_commands_type_check
  CHECK (command_type IN (
    'ping',
    'refresh_status',
    'refresh_session',
    'reload_app',
    'reset_workflow',
    'logout',
    'clear_credentials',
    'control_action'
  ));

CREATE TEMP TABLE inventory_kiosk_devices_to_revoke
ON COMMIT DROP
AS
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      ORDER BY
        COALESCE(
          last_heartbeat_at,
          last_authenticated_at,
          last_seen_at,
          created_at
        ) DESC,
        created_at DESC,
        id DESC
    ) AS active_rank
  FROM public.inventory_kiosk_devices
  WHERE revoked_at IS NULL
)
SELECT id
FROM ranked
WHERE active_rank > 1;

UPDATE public.inventory_kiosk_devices AS device
SET
  revoked_at = NOW(),
  revoked_reason = 'migration_dedupe',
  control_holder_user_id = NULL,
  control_session_id = NULL,
  control_acquired_at = NULL,
  control_lease_expires_at = NULL
FROM inventory_kiosk_devices_to_revoke AS duplicate
WHERE device.id = duplicate.id;

UPDATE public.app_auth_sessions AS session
SET
  revoked_at = NOW(),
  revoked_reason = 'kiosk_device_revoked'
FROM inventory_kiosk_devices_to_revoke AS duplicate
WHERE session.kiosk_device_id = duplicate.id
  AND session.revoked_at IS NULL;

UPDATE public.inventory_kiosk_device_commands AS command
SET status = 'cancelled'
FROM inventory_kiosk_devices_to_revoke AS duplicate
WHERE command.device_id = duplicate.id
  AND command.status IN ('pending', 'accepted');

INSERT INTO public.inventory_kiosk_device_events (
  device_id,
  event_type,
  message,
  details
)
SELECT
  duplicate.id,
  'device_migration_dedupe',
  'Older active Yard kiosk device revoked while enforcing the one-device limit.',
  jsonb_build_object('reason', 'migration_dedupe')
FROM inventory_kiosk_devices_to_revoke AS duplicate;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_kiosk_devices_one_active_idx
  ON public.inventory_kiosk_devices ((TRUE))
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS inventory_kiosk_devices_control_lease_idx
  ON public.inventory_kiosk_devices (control_lease_expires_at)
  WHERE control_session_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.inventory_kiosk_confirm_device_pairing(
  p_manager_user_id UUID,
  p_pairing_id UUID,
  p_confirmation_code TEXT,
  p_confirmed_replacement BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  new_device_id UUID,
  replaced_device_id UUID
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_pairing public.inventory_kiosk_pairing_sessions%ROWTYPE;
  v_existing_device_id UUID;
  v_existing_supersedes_id UUID;
  v_replaced_device_id UUID;
  v_new_device_id UUID;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  SELECT device.id, device.supersedes_device_id
  INTO v_existing_device_id, v_existing_supersedes_id
  FROM public.inventory_kiosk_devices AS device
  WHERE device.pairing_session_id = p_pairing_id
  LIMIT 1;

  IF v_existing_device_id IS NOT NULL THEN
    RETURN QUERY
    SELECT v_existing_device_id, v_existing_supersedes_id;
    RETURN;
  END IF;

  UPDATE public.inventory_kiosk_pairing_sessions
  SET status = 'expired'
  WHERE status IN ('active', 'confirmed')
    AND expires_at <= v_now;

  SELECT pairing.*
  INTO v_pairing
  FROM public.inventory_kiosk_pairing_sessions AS pairing
  JOIN public.inventory_kiosk_config AS config
    ON config.id = 1
   AND config.kiosk_user_id = pairing.kiosk_user_id
   AND config.is_enabled = TRUE
  WHERE pairing.id = p_pairing_id
    AND pairing.status = 'active'
    AND pairing.expires_at > v_now
  FOR UPDATE OF pairing;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'KIOSK_PAIRING_EXPIRED';
  END IF;

  IF v_pairing.confirmation_code IS NULL
    OR v_pairing.pairing_token_hash IS NULL
    OR v_pairing.confirmation_code <> BTRIM(COALESCE(p_confirmation_code, ''))
  THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'KIOSK_PAIRING_CODE_MISMATCH';
  END IF;

  SELECT device.id
  INTO v_replaced_device_id
  FROM public.inventory_kiosk_devices AS device
  WHERE device.kiosk_user_id = v_pairing.kiosk_user_id
    AND device.revoked_at IS NULL
  FOR UPDATE;

  IF v_replaced_device_id IS NOT NULL THEN
    IF NOT p_confirmed_replacement
      OR v_pairing.replaces_device_id IS DISTINCT FROM v_replaced_device_id
    THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'KIOSK_REPLACEMENT_CONFIRMATION_REQUIRED';
    END IF;

    UPDATE public.inventory_kiosk_devices
    SET
      revoked_at = v_now,
      revoked_by = p_manager_user_id,
      revoked_reason = 'replaced_by_pairing',
      control_holder_user_id = NULL,
      control_session_id = NULL,
      control_acquired_at = NULL,
      control_lease_expires_at = NULL
    WHERE id = v_replaced_device_id;

    UPDATE public.app_auth_sessions
    SET
      revoked_at = v_now,
      revoked_reason = 'kiosk_device_replaced'
    WHERE kiosk_device_id = v_replaced_device_id
      AND revoked_at IS NULL;

    UPDATE public.inventory_kiosk_device_commands
    SET status = 'cancelled'
    WHERE device_id = v_replaced_device_id
      AND status IN ('pending', 'accepted');
  END IF;

  INSERT INTO public.inventory_kiosk_devices (
    kiosk_user_id,
    device_token_hash,
    device_label,
    paired_by,
    pairing_session_id,
    last_seen_at,
    supersedes_device_id
  )
  VALUES (
    v_pairing.kiosk_user_id,
    v_pairing.pairing_token_hash,
    v_pairing.device_label,
    p_manager_user_id,
    v_pairing.id,
    v_now,
    v_replaced_device_id
  )
  RETURNING id INTO v_new_device_id;

  IF v_replaced_device_id IS NOT NULL THEN
    UPDATE public.inventory_kiosk_devices
    SET superseded_by_device_id = v_new_device_id
    WHERE id = v_replaced_device_id;

    INSERT INTO public.inventory_kiosk_device_events (
      device_id,
      event_type,
      message,
      details
    )
    VALUES (
      v_replaced_device_id,
      'device_replaced',
      'Yard kiosk device replaced by a manager-confirmed pairing.',
      jsonb_build_object(
        'replacement_device_id', v_new_device_id,
        'manager_user_id', p_manager_user_id
      )
    );
  END IF;

  UPDATE public.inventory_kiosk_pairing_sessions
  SET
    status = 'confirmed',
    confirmed_by = p_manager_user_id,
    confirmed_at = v_now
  WHERE id = v_pairing.id;

  INSERT INTO public.inventory_kiosk_device_events (
    device_id,
    event_type,
    message,
    details
  )
  VALUES (
    v_new_device_id,
    'device_paired',
    'Yard kiosk device pairing confirmed.',
    jsonb_build_object(
      'pairing_id', v_pairing.id,
      'replaced_device_id', v_replaced_device_id,
      'manager_user_id', p_manager_user_id
    )
  );

  RETURN QUERY
  SELECT v_new_device_id, v_replaced_device_id;
END;
$$;

REVOKE ALL ON FUNCTION public.inventory_kiosk_confirm_device_pairing(
  UUID,
  UUID,
  TEXT,
  BOOLEAN
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_kiosk_confirm_device_pairing(
  UUID,
  UUID,
  TEXT,
  BOOLEAN
) TO service_role;

COMMIT;
