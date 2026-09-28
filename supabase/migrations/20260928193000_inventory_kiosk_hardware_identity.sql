-- finalise-phase: predeploy
BEGIN;

ALTER TABLE public.inventory_kiosk_pairing_sessions
  ADD COLUMN IF NOT EXISTS candidate_identity_kind TEXT,
  ADD COLUMN IF NOT EXISTS candidate_hardware_public_key_spki TEXT,
  ADD COLUMN IF NOT EXISTS candidate_hardware_key_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS candidate_hardware_attestation JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS candidate_hardware_seen_at TIMESTAMPTZ;

ALTER TABLE public.inventory_kiosk_pairing_sessions
  DROP CONSTRAINT IF EXISTS inventory_kiosk_pairing_candidate_identity_check;
ALTER TABLE public.inventory_kiosk_pairing_sessions
  ADD CONSTRAINT inventory_kiosk_pairing_candidate_identity_check
  CHECK (
    candidate_identity_kind IS NULL
    OR candidate_identity_kind = 'android_keystore'
  );

ALTER TABLE public.inventory_kiosk_devices
  ADD COLUMN IF NOT EXISTS hardware_identity_kind TEXT NOT NULL DEFAULT 'browser_cookie',
  ADD COLUMN IF NOT EXISTS hardware_public_key_spki TEXT,
  ADD COLUMN IF NOT EXISTS hardware_key_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS hardware_attestation JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS hardware_bound_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_device_proof_at TIMESTAMPTZ;

ALTER TABLE public.inventory_kiosk_devices
  DROP CONSTRAINT IF EXISTS inventory_kiosk_devices_hardware_identity_check;
ALTER TABLE public.inventory_kiosk_devices
  ADD CONSTRAINT inventory_kiosk_devices_hardware_identity_check
  CHECK (
    (
      hardware_identity_kind = 'browser_cookie'
      AND hardware_public_key_spki IS NULL
      AND hardware_key_fingerprint IS NULL
      AND hardware_bound_at IS NULL
    )
    OR
    (
      hardware_identity_kind = 'android_keystore'
      AND hardware_public_key_spki IS NOT NULL
      AND hardware_key_fingerprint IS NOT NULL
      AND hardware_bound_at IS NOT NULL
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS inventory_kiosk_devices_active_hardware_key_idx
  ON public.inventory_kiosk_devices (hardware_key_fingerprint)
  WHERE hardware_key_fingerprint IS NOT NULL
    AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.inventory_kiosk_device_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose TEXT NOT NULL,
  pairing_session_id UUID
    REFERENCES public.inventory_kiosk_pairing_sessions(id) ON DELETE CASCADE,
  device_id UUID
    REFERENCES public.inventory_kiosk_devices(id) ON DELETE CASCADE,
  challenge_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventory_kiosk_device_challenges_purpose_check
    CHECK (purpose IN ('android_enrollment', 'android_authentication')),
  CONSTRAINT inventory_kiosk_device_challenges_scope_check
    CHECK (
      (pairing_session_id IS NOT NULL)::INTEGER
      + (device_id IS NOT NULL)::INTEGER = 1
    )
);

CREATE INDEX IF NOT EXISTS inventory_kiosk_device_challenges_expiry_idx
  ON public.inventory_kiosk_device_challenges (expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.inventory_kiosk_device_request_proofs (
  request_id UUID PRIMARY KEY,
  device_id UUID NOT NULL
    REFERENCES public.inventory_kiosk_devices(id) ON DELETE CASCADE,
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS inventory_kiosk_device_request_proofs_expiry_idx
  ON public.inventory_kiosk_device_request_proofs (expires_at);

ALTER TABLE public.inventory_kiosk_device_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_kiosk_device_request_proofs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Browser users cannot access kiosk device challenges directly"
  ON public.inventory_kiosk_device_challenges;
CREATE POLICY "Browser users cannot access kiosk device challenges directly"
  ON public.inventory_kiosk_device_challenges
  FOR ALL
  TO anon, authenticated
  USING (FALSE)
  WITH CHECK (FALSE);

DROP POLICY IF EXISTS "Browser users cannot access kiosk device proofs directly"
  ON public.inventory_kiosk_device_request_proofs;
CREATE POLICY "Browser users cannot access kiosk device proofs directly"
  ON public.inventory_kiosk_device_request_proofs
  FOR ALL
  TO anon, authenticated
  USING (FALSE)
  WITH CHECK (FALSE);

REVOKE ALL ON TABLE public.inventory_kiosk_device_challenges
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.inventory_kiosk_device_request_proofs
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.inventory_kiosk_device_challenges TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.inventory_kiosk_device_request_proofs TO service_role;

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
  WHERE status = 'active'
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

  IF v_pairing.candidate_identity_kind = 'android_keystore'
    AND (
      v_pairing.candidate_hardware_public_key_spki IS NULL
      OR v_pairing.candidate_hardware_key_fingerprint IS NULL
      OR v_pairing.candidate_hardware_seen_at IS NULL
    )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'KIOSK_HARDWARE_IDENTITY_INCOMPLETE';
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
    supersedes_device_id,
    hardware_identity_kind,
    hardware_public_key_spki,
    hardware_key_fingerprint,
    hardware_attestation,
    hardware_bound_at
  )
  VALUES (
    v_pairing.kiosk_user_id,
    v_pairing.pairing_token_hash,
    v_pairing.device_label,
    p_manager_user_id,
    v_pairing.id,
    v_now,
    v_replaced_device_id,
    CASE
      WHEN v_pairing.candidate_identity_kind IS NULL
        THEN 'browser_cookie'
      ELSE 'android_keystore'
    END,
    v_pairing.candidate_hardware_public_key_spki,
    v_pairing.candidate_hardware_key_fingerprint,
    COALESCE(v_pairing.candidate_hardware_attestation, '{}'::jsonb),
    CASE
      WHEN v_pairing.candidate_identity_kind IS NULL
        THEN NULL
      ELSE v_now
    END
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
    CASE
      WHEN v_pairing.candidate_identity_kind IS NULL
        THEN 'Yard kiosk browser pairing confirmed.'
      ELSE 'Yard kiosk hardware-bound Android pairing confirmed.'
    END,
    jsonb_build_object(
      'pairing_id', v_pairing.id,
      'replaced_device_id', v_replaced_device_id,
      'manager_user_id', p_manager_user_id,
      'hardware_identity_kind',
        CASE
          WHEN v_pairing.candidate_identity_kind IS NULL
            THEN 'browser_cookie'
          ELSE 'android_keystore'
        END
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

CREATE OR REPLACE FUNCTION public.inventory_kiosk_execute_hardware_bound_basket(
  p_actor UUID,
  p_kiosk_device_id UUID,
  p_unallocated BOOLEAN,
  p_direction TEXT,
  p_counterpart_location_id UUID,
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
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_device public.inventory_kiosk_devices%ROWTYPE;
BEGIN
  SELECT device.*
  INTO v_device
  FROM public.inventory_kiosk_devices AS device
  WHERE device.id = p_kiosk_device_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_device.revoked_at IS NOT NULL
    OR v_device.kiosk_user_id <> p_actor
    OR v_device.hardware_identity_kind <> 'android_keystore'
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Yard kiosk hardware device is inactive';
  END IF;

  IF p_unallocated THEN
    RETURN QUERY
    SELECT
      result.kiosk_batch_id,
      result.movement_batch_id,
      result.hardware_batch_id,
      result.reminder_action_id,
      result.serialized_count,
      result.hardware_line_count
    FROM public.inventory_kiosk_execute_unallocated_take(
      p_actor,
      p_serialized_item_ids,
      p_hardware_lines,
      p_location_details,
      p_note
    ) AS result;
  ELSE
    RETURN QUERY
    SELECT
      result.kiosk_batch_id,
      result.movement_batch_id,
      result.hardware_batch_id,
      NULL::UUID,
      result.serialized_count,
      result.hardware_line_count
    FROM public.inventory_kiosk_execute_transfer_basket(
      p_actor,
      p_direction,
      p_counterpart_location_id,
      p_serialized_item_ids,
      p_hardware_lines,
      p_note
    ) AS result;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.inventory_kiosk_execute_hardware_bound_basket(
  UUID,
  UUID,
  BOOLEAN,
  TEXT,
  UUID,
  UUID[],
  JSONB,
  TEXT,
  TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_kiosk_execute_hardware_bound_basket(
  UUID,
  UUID,
  BOOLEAN,
  TEXT,
  UUID,
  UUID[],
  JSONB,
  TEXT,
  TEXT
) TO service_role;

COMMENT ON COLUMN public.inventory_kiosk_devices.hardware_identity_kind IS
  'Authentication anchor: legacy browser cookie or non-exportable Android Keystore key.';
COMMENT ON COLUMN public.inventory_kiosk_devices.hardware_public_key_spki IS
  'Base64 DER SubjectPublicKeyInfo for the paired Android hardware key.';
COMMENT ON TABLE public.inventory_kiosk_device_challenges IS
  'Short-lived, single-use challenges for Android kiosk enrollment and authentication.';
COMMENT ON TABLE public.inventory_kiosk_device_request_proofs IS
  'Consumed request identifiers preventing replay of Android kiosk hardware signatures.';

COMMIT;
