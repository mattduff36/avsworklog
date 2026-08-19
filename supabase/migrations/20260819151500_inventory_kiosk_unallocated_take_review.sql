-- Review closure: grant private helpers to service_role and stop Yard
-- transfer actions escaping the allocate-only lifecycle by changing workflow_key.

BEGIN;

CREATE OR REPLACE FUNCTION private.protect_inventory_kiosk_unallocated_action()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.workflow_key = 'inventory_kiosk_unallocated_take' THEN
      RAISE EXCEPTION 'Yard transfer actions cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.workflow_key = 'inventory_kiosk_unallocated_take'
    AND NEW.workflow_key IS DISTINCT FROM OLD.workflow_key
  THEN
    RAISE EXCEPTION 'Yard transfer action fields cannot change outside allocation';
  END IF;

  IF NEW.workflow_key IS DISTINCT FROM 'inventory_kiosk_unallocated_take' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF private.inventory_kiosk_action_lifecycle() <> 'unallocated_take' THEN
      RAISE EXCEPTION 'Yard transfer actions can only be created by the kiosk take';
    END IF;
    RETURN NEW;
  END IF;

  IF private.inventory_kiosk_action_lifecycle() <> 'allocate' THEN
    RAISE EXCEPTION 'Yard transfer actions can only be resolved by allocation';
  END IF;

  IF OLD.status <> 'open' OR NEW.status <> 'resolved' THEN
    RAISE EXCEPTION 'Yard transfer actions can only move from open to resolved';
  END IF;

  IF NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key
    OR NEW.workflow_key IS DISTINCT FROM OLD.workflow_key
    OR NEW.source_type IS DISTINCT FROM OLD.source_type
    OR NEW.ignored_forever IS DISTINCT FROM OLD.ignored_forever
    OR NEW.ignored_until IS DISTINCT FROM OLD.ignored_until
    OR NEW.ignored_at IS DISTINCT FROM OLD.ignored_at
    OR NEW.ignored_by IS DISTINCT FROM OLD.ignored_by
  THEN
    RAISE EXCEPTION 'Yard transfer action fields cannot change outside allocation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.inventory_allow_transfer_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.inventory_kiosk_action_lifecycle() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.inventory_location_is_transfer(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.inventory_require_transfer_location() FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO service_role;
GRANT EXECUTE ON FUNCTION private.inventory_allow_transfer_mutation() TO service_role;
GRANT EXECUTE ON FUNCTION private.inventory_kiosk_action_lifecycle() TO service_role;
GRANT EXECUTE ON FUNCTION private.inventory_location_is_transfer(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION private.inventory_require_transfer_location() TO service_role;

UPDATE public.inventory_kiosk_transfer_batches
SET location_details = BTRIM(location_details)
WHERE location_details IS NOT NULL
  AND location_details IS DISTINCT FROM BTRIM(location_details);

ALTER TABLE public.inventory_kiosk_transfer_batches
  DROP CONSTRAINT IF EXISTS inventory_kiosk_transfer_batches_allocation_state_check;

ALTER TABLE public.inventory_kiosk_transfer_batches
  ADD CONSTRAINT inventory_kiosk_transfer_batches_allocation_state_check
  CHECK (
    (
      allocation_status = 'allocated'
      AND location_details IS NULL
      AND reminder_action_id IS NULL
      AND allocated_location_id IS NULL
      AND allocation_movement_batch_id IS NULL
      AND allocation_hardware_batch_id IS NULL
      AND allocated_by IS NULL
      AND allocated_at IS NULL
    )
    OR (
      direction = 'take'
      AND allocation_status = 'pending'
      AND location_details IS NOT NULL
      AND location_details = BTRIM(location_details)
      AND char_length(location_details) BETWEEN 1 AND 500
      AND reminder_action_id IS NOT NULL
      AND allocated_location_id IS NULL
      AND allocation_movement_batch_id IS NULL
      AND allocation_hardware_batch_id IS NULL
      AND allocated_by IS NULL
      AND allocated_at IS NULL
    )
    OR (
      direction = 'take'
      AND allocation_status = 'allocated'
      AND location_details IS NOT NULL
      AND location_details = BTRIM(location_details)
      AND char_length(location_details) BETWEEN 1 AND 500
      AND reminder_action_id IS NOT NULL
      AND allocated_location_id IS NOT NULL
      AND allocated_by IS NOT NULL
      AND allocated_at IS NOT NULL
      AND (
        allocation_movement_batch_id IS NOT NULL
        OR allocation_hardware_batch_id IS NOT NULL
      )
    )
  );

COMMIT;
