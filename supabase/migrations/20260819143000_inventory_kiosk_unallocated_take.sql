-- Yard kiosk unallocated Collect: singleton In transfer location, typed-take RPC,
-- allocate RPC, and database guards so transfer stock cannot be mutated ordinarily.

BEGIN;

CREATE OR REPLACE FUNCTION private.inventory_allow_transfer_mutation()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(current_setting('inventory.transfer_mutation', true), '')
    IN ('kiosk_unallocated_take', 'kiosk_allocate');
$$;

CREATE OR REPLACE FUNCTION private.inventory_kiosk_action_lifecycle()
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(current_setting('inventory.kiosk_action_lifecycle', true), '');
$$;

CREATE OR REPLACE FUNCTION private.inventory_location_is_transfer(p_location_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.inventory_locations
    WHERE id = p_location_id
      AND location_type = 'transfer'
  );
$$;

CREATE OR REPLACE FUNCTION private.inventory_require_transfer_location()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
  v_id UUID;
BEGIN
  SELECT COUNT(*)::INTEGER, (array_agg(id ORDER BY created_at, id))[1]
  INTO v_count, v_id
  FROM public.inventory_locations
  WHERE is_active = TRUE
    AND location_type = 'transfer';

  IF v_count <> 1 OR v_id IS NULL THEN
    RAISE EXCEPTION 'Exactly one active In transfer location is required';
  END IF;

  RETURN v_id;
END;
$$;

ALTER TABLE public.inventory_locations
  DROP CONSTRAINT IF EXISTS inventory_locations_location_type_check;

ALTER TABLE public.inventory_locations
  ADD CONSTRAINT inventory_locations_location_type_check
    CHECK (location_type IN ('yard', 'unknown', 'van', 'hgv', 'plant', 'site', 'manual', 'transfer'));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.inventory_locations
    WHERE LOWER(BTRIM(name)) = 'in transfer'
  ) THEN
    RAISE EXCEPTION 'Conflicting In transfer location already exists';
  END IF;
END;
$$;

INSERT INTO public.inventory_locations (
  name,
  description,
  location_type,
  source_type,
  sync_status,
  is_active
)
VALUES (
  'In transfer',
  'Holding location for Yard kiosk takes that still need a real destination',
  'transfer',
  'system',
  'manual',
  TRUE
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_locations_one_active_transfer_idx
  ON public.inventory_locations (location_type)
  WHERE is_active = TRUE
    AND location_type = 'transfer';

ALTER TABLE public.inventory_item_movement_batches
  DROP CONSTRAINT IF EXISTS inventory_item_movement_batches_scope_check;

ALTER TABLE public.inventory_item_movement_batches
  ADD CONSTRAINT inventory_item_movement_batches_scope_check
  CHECK (move_scope IN ('single', 'bulk', 'group', 'claim', 'kiosk', 'kiosk_allocate'));

ALTER TABLE public.inventory_kiosk_transfer_batches
  ADD COLUMN IF NOT EXISTS location_details TEXT,
  ADD COLUMN IF NOT EXISTS reminder_action_id UUID REFERENCES public.reminder_actions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS allocation_status TEXT NOT NULL DEFAULT 'allocated',
  ADD COLUMN IF NOT EXISTS allocated_location_id UUID REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS allocation_movement_batch_id UUID REFERENCES public.inventory_item_movement_batches(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS allocation_hardware_batch_id UUID REFERENCES public.inventory_hardware_transaction_batches(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS allocated_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS allocated_at TIMESTAMPTZ;

ALTER TABLE public.inventory_kiosk_transfer_batches
  DROP CONSTRAINT IF EXISTS inventory_kiosk_transfer_batches_allocation_status_check;

ALTER TABLE public.inventory_kiosk_transfer_batches
  ADD CONSTRAINT inventory_kiosk_transfer_batches_allocation_status_check
  CHECK (allocation_status IN ('pending', 'allocated'));

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

CREATE UNIQUE INDEX IF NOT EXISTS inventory_kiosk_transfer_batches_reminder_action_uidx
  ON public.inventory_kiosk_transfer_batches (reminder_action_id)
  WHERE reminder_action_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS reminder_actions_kiosk_unallocated_dedupe_uidx
  ON public.reminder_actions (dedupe_key)
  WHERE workflow_key = 'inventory_kiosk_unallocated_take';

CREATE OR REPLACE FUNCTION private.protect_inventory_transfer_location()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF LOWER(BTRIM(NEW.name)) = 'in transfer' OR NEW.location_type = 'transfer' THEN
      RAISE EXCEPTION 'The In transfer location is a reserved system location';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.location_type = 'transfer' OR LOWER(BTRIM(OLD.name)) = 'in transfer' THEN
      RAISE EXCEPTION 'The In transfer location cannot be removed';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.location_type = 'transfer' OR LOWER(BTRIM(OLD.name)) = 'in transfer' THEN
    IF NEW.name IS DISTINCT FROM OLD.name
      OR NEW.location_type IS DISTINCT FROM OLD.location_type
      OR NEW.source_type IS DISTINCT FROM OLD.source_type
      OR NEW.is_active IS DISTINCT FROM OLD.is_active
      OR NEW.linked_van_id IS DISTINCT FROM OLD.linked_van_id
      OR NEW.linked_hgv_id IS DISTINCT FROM OLD.linked_hgv_id
      OR NEW.linked_plant_id IS DISTINCT FROM OLD.linked_plant_id
      OR NEW.description IS DISTINCT FROM OLD.description
    THEN
      RAISE EXCEPTION 'The In transfer location is a reserved system location';
    END IF;
  END IF;

  IF LOWER(BTRIM(NEW.name)) = 'in transfer' AND NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'In transfer is a reserved location name';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_inventory_transfer_location ON public.inventory_locations;
CREATE TRIGGER trg_protect_inventory_transfer_location
  BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_locations
  FOR EACH ROW
  EXECUTE FUNCTION private.protect_inventory_transfer_location();

CREATE OR REPLACE FUNCTION private.protect_inventory_transfer_item_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF private.inventory_location_is_transfer(NEW.location_id)
      AND NOT private.inventory_allow_transfer_mutation() THEN
      RAISE EXCEPTION 'In transfer stock can only be moved by Yard allocation';
    END IF;
    RETURN NEW;
  END IF;

  IF private.inventory_location_is_transfer(OLD.location_id)
    OR private.inventory_location_is_transfer(NEW.location_id) THEN
    IF (
      NEW.location_id IS DISTINCT FROM OLD.location_id
      OR NEW.status IS DISTINCT FROM OLD.status
    ) AND NOT private.inventory_allow_transfer_mutation() THEN
      RAISE EXCEPTION 'In transfer stock can only be moved by Yard allocation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_inventory_transfer_item_stock ON public.inventory_items;
CREATE TRIGGER trg_protect_inventory_transfer_item_stock
  BEFORE INSERT OR UPDATE ON public.inventory_items
  FOR EACH ROW
  EXECUTE FUNCTION private.protect_inventory_transfer_item_stock();

CREATE OR REPLACE FUNCTION private.protect_inventory_transfer_hardware_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF private.inventory_location_is_transfer(NEW.location_id)
      AND NOT private.inventory_allow_transfer_mutation() THEN
      RAISE EXCEPTION 'Hardware at In transfer can only be moved by Yard allocation';
    END IF;
    RETURN NEW;
  END IF;

  IF (
    private.inventory_location_is_transfer(OLD.location_id)
    OR private.inventory_location_is_transfer(NEW.location_id)
  ) AND NOT private.inventory_allow_transfer_mutation() THEN
    RAISE EXCEPTION 'Hardware at In transfer can only be moved by Yard allocation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_inventory_transfer_hardware_stock ON public.inventory_hardware_balances;
CREATE TRIGGER trg_protect_inventory_transfer_hardware_stock
  BEFORE INSERT OR UPDATE ON public.inventory_hardware_balances
  FOR EACH ROW
  EXECUTE FUNCTION private.protect_inventory_transfer_hardware_stock();

CREATE OR REPLACE FUNCTION private.protect_inventory_transfer_user_location()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF private.inventory_location_is_transfer(NEW.location_id) THEN
    RAISE EXCEPTION 'In transfer cannot be assigned as a user location';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_inventory_transfer_user_location ON public.inventory_user_locations;
CREATE TRIGGER trg_protect_inventory_transfer_user_location
  BEFORE INSERT OR UPDATE ON public.inventory_user_locations
  FOR EACH ROW
  EXECUTE FUNCTION private.protect_inventory_transfer_user_location();

DROP TRIGGER IF EXISTS trg_protect_inventory_transfer_user_site_location ON public.inventory_user_site_locations;
CREATE TRIGGER trg_protect_inventory_transfer_user_site_location
  BEFORE INSERT OR UPDATE ON public.inventory_user_site_locations
  FOR EACH ROW
  EXECUTE FUNCTION private.protect_inventory_transfer_user_location();

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

DROP TRIGGER IF EXISTS trg_protect_inventory_kiosk_unallocated_action ON public.reminder_actions;
CREATE TRIGGER trg_protect_inventory_kiosk_unallocated_action
  BEFORE INSERT OR UPDATE OR DELETE ON public.reminder_actions
  FOR EACH ROW
  EXECUTE FUNCTION private.protect_inventory_kiosk_unallocated_action();

CREATE OR REPLACE FUNCTION private.protect_inventory_kiosk_unallocated_reminders()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.reminder_actions
    WHERE id = NEW.action_id
      AND workflow_key = 'inventory_kiosk_unallocated_take'
  ) THEN
    RAISE EXCEPTION 'Yard transfer actions cannot have reminders';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_inventory_kiosk_unallocated_reminders ON public.reminders;
CREATE TRIGGER trg_protect_inventory_kiosk_unallocated_reminders
  BEFORE INSERT OR UPDATE ON public.reminders
  FOR EACH ROW
  EXECUTE FUNCTION private.protect_inventory_kiosk_unallocated_reminders();

CREATE OR REPLACE FUNCTION public.inventory_transfer_items(
  p_item_ids UUID[],
  p_destination_location_id UUID,
  p_note TEXT,
  p_moved_by UUID,
  p_movement_batch_id UUID
)
RETURNS TABLE(item_id UUID, from_location_id UUID, to_location_id UUID)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.inventory_locations
    WHERE id = p_destination_location_id
      AND is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'Destination location not found';
  END IF;

  IF private.inventory_location_is_transfer(p_destination_location_id)
    AND NOT private.inventory_allow_transfer_mutation() THEN
    RAISE EXCEPTION 'In transfer stock can only be moved by Yard allocation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.inventory_items AS item
    JOIN public.inventory_locations AS loc
      ON loc.id = item.location_id
    WHERE item.id = ANY(p_item_ids)
      AND loc.location_type = 'transfer'
  ) AND NOT private.inventory_allow_transfer_mutation() THEN
    RAISE EXCEPTION 'In transfer stock can only be moved by Yard allocation';
  END IF;

  RETURN QUERY
  WITH locked_items AS (
    SELECT id, location_id
    FROM public.inventory_items
    WHERE id = ANY(p_item_ids)
      AND status = 'active'
    ORDER BY id
    FOR UPDATE
  ),
  changed_items AS (
    SELECT id, location_id
    FROM locked_items
    WHERE location_id IS DISTINCT FROM p_destination_location_id
  ),
  updated_items AS (
    UPDATE public.inventory_items AS item
    SET location_id = p_destination_location_id,
        updated_by = p_moved_by
    FROM changed_items
    WHERE item.id = changed_items.id
    RETURNING item.id, changed_items.location_id AS from_location_id, item.location_id AS to_location_id
  )
  INSERT INTO public.inventory_item_movements (
    item_id,
    from_location_id,
    to_location_id,
    note,
    moved_by,
    movement_batch_id
  )
  SELECT
    updated_items.id,
    updated_items.from_location_id,
    updated_items.to_location_id,
    NULLIF(BTRIM(p_note), ''),
    p_moved_by,
    p_movement_batch_id
  FROM updated_items
  RETURNING
    inventory_item_movements.item_id,
    inventory_item_movements.from_location_id,
    inventory_item_movements.to_location_id;
END;
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
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_yard_location_id UUID;
  v_yard_count INTEGER;
  v_source_location_id UUID;
  v_destination_location_id UUID;
  v_serialized_count INTEGER := COALESCE(cardinality(p_serialized_item_ids), 0);
  v_moved_count INTEGER := 0;
  v_hardware_count INTEGER := 0;
  v_hardware_valid_count INTEGER := 0;
  v_hardware_transfer_lines JSONB := '[]'::JSONB;
  v_kiosk_batch_id UUID;
  v_movement_batch_id UUID;
  v_hardware_batch_id UUID;
  v_line JSONB;
  v_item_id UUID;
  v_quantity INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.inventory_kiosk_config
    WHERE id = 1
      AND kiosk_user_id = p_actor
      AND is_enabled = TRUE
  ) THEN
    RAISE EXCEPTION 'Yard kiosk access denied';
  END IF;

  IF p_direction NOT IN ('take', 'return') THEN
    RAISE EXCEPTION 'Yard kiosk direction must be take or return';
  END IF;

  SELECT
    COUNT(*)::INTEGER,
    (array_agg(id ORDER BY created_at, id))[1]
  INTO v_yard_count, v_yard_location_id
  FROM public.inventory_locations
  WHERE is_active = TRUE
    AND location_type = 'yard';

  IF v_yard_count <> 1 OR v_yard_location_id IS NULL THEN
    RAISE EXCEPTION 'Exactly one active Yard location is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.inventory_locations
    WHERE id = p_counterpart_location_id
      AND is_active = TRUE
      AND location_type NOT IN ('yard', 'unknown', 'transfer')
  ) THEN
    RAISE EXCEPTION 'Active non-Yard counterpart location not found';
  END IF;

  IF p_direction = 'take' THEN
    v_source_location_id := v_yard_location_id;
    v_destination_location_id := p_counterpart_location_id;
  ELSE
    v_source_location_id := p_counterpart_location_id;
    v_destination_location_id := v_yard_location_id;
  END IF;

  p_serialized_item_ids := COALESCE(p_serialized_item_ids, ARRAY[]::UUID[]);
  p_hardware_lines := COALESCE(p_hardware_lines, '[]'::JSONB);

  IF jsonb_typeof(p_hardware_lines) <> 'array' THEN
    RAISE EXCEPTION 'Yard kiosk Hardware lines must be an array';
  END IF;

  v_hardware_count := jsonb_array_length(p_hardware_lines);

  IF v_serialized_count = 0 AND v_hardware_count = 0 THEN
    RAISE EXCEPTION 'Yard kiosk basket must contain at least one item';
  END IF;

  IF v_serialized_count > 500 OR v_hardware_count > 500 THEN
    RAISE EXCEPTION 'Yard kiosk baskets support at most 500 lines of each type';
  END IF;

  IF v_serialized_count <> (
    SELECT COUNT(DISTINCT item_id)::INTEGER
    FROM unnest(p_serialized_item_ids) AS item_id
  ) THEN
    RAISE EXCEPTION 'Duplicate serialized Inventory items are not allowed';
  END IF;

  IF v_serialized_count > 0 THEN
    PERFORM item.id
    FROM public.inventory_items AS item
    WHERE item.id = ANY(p_serialized_item_ids)
    ORDER BY item.id
    FOR UPDATE;

    IF v_serialized_count <> (
      SELECT COUNT(*)::INTEGER
      FROM public.inventory_items AS item
      WHERE item.id = ANY(p_serialized_item_ids)
        AND item.status = 'active'
        AND item.location_id = v_source_location_id
    ) THEN
      RAISE EXCEPTION 'One or more serialized Inventory items are unavailable at the source location';
    END IF;
  END IF;

  IF v_hardware_count > 0 THEN
    IF v_hardware_count <> (
      SELECT COUNT(DISTINCT value->>'item_id')::INTEGER
      FROM jsonb_array_elements(p_hardware_lines)
    ) THEN
      RAISE EXCEPTION 'Duplicate Hardware items are not allowed';
    END IF;

    FOR v_line IN SELECT value FROM jsonb_array_elements(p_hardware_lines)
    LOOP
      v_item_id := NULLIF(v_line->>'item_id', '')::UUID;
      v_quantity := NULLIF(v_line->>'quantity', '')::INTEGER;

      IF v_item_id IS NULL OR v_quantity IS NULL OR v_quantity <= 0 THEN
        RAISE EXCEPTION 'Every Hardware line requires an item and positive whole-number quantity';
      END IF;
    END LOOP;

    PERFORM balance.id
    FROM public.inventory_hardware_balances AS balance
    JOIN jsonb_array_elements(p_hardware_lines) AS line
      ON balance.hardware_item_id = (line.value->>'item_id')::UUID
    WHERE balance.location_id = v_source_location_id
    ORDER BY balance.hardware_item_id
    FOR UPDATE OF balance;

    SELECT COUNT(*)::INTEGER
    INTO v_hardware_valid_count
    FROM jsonb_array_elements(p_hardware_lines) AS line
    JOIN public.inventory_hardware_items AS item
      ON item.id = (line.value->>'item_id')::UUID
      AND item.is_active = TRUE
    JOIN public.inventory_hardware_balances AS balance
      ON balance.hardware_item_id = item.id
      AND balance.location_id = v_source_location_id
      AND balance.quantity >= (line.value->>'quantity')::INTEGER;

    IF v_hardware_valid_count <> v_hardware_count THEN
      RAISE EXCEPTION 'One or more Hardware quantities are unavailable at the source location';
    END IF;

    SELECT jsonb_agg(
      jsonb_build_object(
        'item_id', line.value->>'item_id',
        'from_location_id', v_source_location_id,
        'to_location_id', v_destination_location_id,
        'quantity', (line.value->>'quantity')::INTEGER
      )
    )
    INTO v_hardware_transfer_lines
    FROM jsonb_array_elements(p_hardware_lines) AS line;
  END IF;

  INSERT INTO public.inventory_kiosk_transfer_batches (
    direction,
    yard_location_id,
    counterpart_location_id,
    note,
    created_by
  )
  VALUES (
    p_direction,
    v_yard_location_id,
    p_counterpart_location_id,
    NULLIF(BTRIM(COALESCE(p_note, '')), ''),
    p_actor
  )
  RETURNING id INTO v_kiosk_batch_id;

  IF v_serialized_count > 0 THEN
    INSERT INTO public.inventory_item_movement_batches (
      move_scope,
      destination_location_id,
      note,
      moved_by
    )
    VALUES (
      'kiosk',
      v_destination_location_id,
      NULLIF(BTRIM(COALESCE(p_note, '')), ''),
      p_actor
    )
    RETURNING id INTO v_movement_batch_id;

    SELECT COUNT(*)::INTEGER
    INTO v_moved_count
    FROM public.inventory_transfer_items(
      p_serialized_item_ids,
      v_destination_location_id,
      p_note,
      p_actor,
      v_movement_batch_id
    );

    IF v_moved_count <> v_serialized_count THEN
      RAISE EXCEPTION 'Serialized Inventory basket changed before it could be committed';
    END IF;
  END IF;

  IF v_hardware_count > 0 THEN
    SELECT public.inventory_transfer_hardware_stock(
      v_hardware_transfer_lines,
      p_note,
      p_actor
    )
    INTO v_hardware_batch_id;
  END IF;

  UPDATE public.inventory_kiosk_transfer_batches
  SET movement_batch_id = v_movement_batch_id,
      hardware_batch_id = v_hardware_batch_id
  WHERE id = v_kiosk_batch_id;

  RETURN QUERY
  SELECT
    v_kiosk_batch_id,
    v_movement_batch_id,
    v_hardware_batch_id,
    v_moved_count,
    v_hardware_count;
END;
$$;

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
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_yard_location_id UUID;
  v_yard_count INTEGER;
  v_transfer_location_id UUID;
  v_details TEXT := BTRIM(COALESCE(p_location_details, ''));
  v_serialized_count INTEGER := COALESCE(cardinality(p_serialized_item_ids), 0);
  v_moved_count INTEGER := 0;
  v_hardware_count INTEGER := 0;
  v_hardware_valid_count INTEGER := 0;
  v_hardware_transfer_lines JSONB := '[]'::JSONB;
  v_kiosk_batch_id UUID := gen_random_uuid();
  v_action_id UUID := gen_random_uuid();
  v_movement_batch_id UUID;
  v_hardware_batch_id UUID;
  v_line JSONB;
  v_item_id UUID;
  v_quantity INTEGER;
  v_serialized_snapshot JSONB := '[]'::JSONB;
  v_hardware_snapshot JSONB := '[]'::JSONB;
  v_title TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.inventory_kiosk_config
    WHERE id = 1
      AND kiosk_user_id = p_actor
      AND is_enabled = TRUE
  ) THEN
    RAISE EXCEPTION 'Yard kiosk access denied';
  END IF;

  IF char_length(v_details) < 1 OR char_length(v_details) > 500 THEN
    RAISE EXCEPTION 'Location details must be between 1 and 500 characters';
  END IF;

  SELECT
    COUNT(*)::INTEGER,
    (array_agg(id ORDER BY created_at, id))[1]
  INTO v_yard_count, v_yard_location_id
  FROM public.inventory_locations
  WHERE is_active = TRUE
    AND location_type = 'yard';

  IF v_yard_count <> 1 OR v_yard_location_id IS NULL THEN
    RAISE EXCEPTION 'Exactly one active Yard location is required';
  END IF;

  v_transfer_location_id := private.inventory_require_transfer_location();

  PERFORM set_config('inventory.transfer_mutation', 'kiosk_unallocated_take', TRUE);
  PERFORM set_config('inventory.kiosk_action_lifecycle', 'unallocated_take', TRUE);

  p_serialized_item_ids := COALESCE(p_serialized_item_ids, ARRAY[]::UUID[]);
  p_hardware_lines := COALESCE(p_hardware_lines, '[]'::JSONB);

  IF jsonb_typeof(p_hardware_lines) <> 'array' THEN
    RAISE EXCEPTION 'Yard kiosk Hardware lines must be an array';
  END IF;

  v_hardware_count := jsonb_array_length(p_hardware_lines);

  IF v_serialized_count = 0 AND v_hardware_count = 0 THEN
    RAISE EXCEPTION 'Yard kiosk basket must contain at least one item';
  END IF;

  IF v_serialized_count > 500 OR v_hardware_count > 500 THEN
    RAISE EXCEPTION 'Yard kiosk baskets support at most 500 lines of each type';
  END IF;

  IF v_serialized_count <> (
    SELECT COUNT(DISTINCT item_id)::INTEGER
    FROM unnest(p_serialized_item_ids) AS item_id
  ) THEN
    RAISE EXCEPTION 'Duplicate serialized Inventory items are not allowed';
  END IF;

  IF v_serialized_count > 0 THEN
    PERFORM item.id
    FROM public.inventory_items AS item
    WHERE item.id = ANY(p_serialized_item_ids)
    ORDER BY item.id
    FOR UPDATE;

    IF v_serialized_count <> (
      SELECT COUNT(*)::INTEGER
      FROM public.inventory_items AS item
      WHERE item.id = ANY(p_serialized_item_ids)
        AND item.status = 'active'
        AND item.location_id = v_yard_location_id
    ) THEN
      RAISE EXCEPTION 'One or more serialized Inventory items are unavailable at the source location';
    END IF;

    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', item.id,
        'item_number', item.item_number,
        'name', item.name
      )
      ORDER BY item.id
    ), '[]'::JSONB)
    INTO v_serialized_snapshot
    FROM public.inventory_items AS item
    WHERE item.id = ANY(p_serialized_item_ids);
  END IF;

  IF v_hardware_count > 0 THEN
    IF v_hardware_count <> (
      SELECT COUNT(DISTINCT value->>'item_id')::INTEGER
      FROM jsonb_array_elements(p_hardware_lines)
    ) THEN
      RAISE EXCEPTION 'Duplicate Hardware items are not allowed';
    END IF;

    FOR v_line IN SELECT value FROM jsonb_array_elements(p_hardware_lines)
    LOOP
      v_item_id := NULLIF(v_line->>'item_id', '')::UUID;
      v_quantity := NULLIF(v_line->>'quantity', '')::INTEGER;

      IF v_item_id IS NULL OR v_quantity IS NULL OR v_quantity <= 0 THEN
        RAISE EXCEPTION 'Every Hardware line requires an item and positive whole-number quantity';
      END IF;
    END LOOP;

    PERFORM balance.id
    FROM public.inventory_hardware_balances AS balance
    JOIN jsonb_array_elements(p_hardware_lines) AS line
      ON balance.hardware_item_id = (line.value->>'item_id')::UUID
    WHERE balance.location_id = v_yard_location_id
    ORDER BY balance.hardware_item_id
    FOR UPDATE OF balance;

    SELECT COUNT(*)::INTEGER
    INTO v_hardware_valid_count
    FROM jsonb_array_elements(p_hardware_lines) AS line
    JOIN public.inventory_hardware_items AS item
      ON item.id = (line.value->>'item_id')::UUID
      AND item.is_active = TRUE
    JOIN public.inventory_hardware_balances AS balance
      ON balance.hardware_item_id = item.id
      AND balance.location_id = v_yard_location_id
      AND balance.quantity >= (line.value->>'quantity')::INTEGER;

    IF v_hardware_valid_count <> v_hardware_count THEN
      RAISE EXCEPTION 'One or more Hardware quantities are unavailable at the source location';
    END IF;

    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', item.id,
        'name', item.name,
        'quantity', (line.value->>'quantity')::INTEGER
      )
      ORDER BY item.id
    ), '[]'::JSONB)
    INTO v_hardware_snapshot
    FROM jsonb_array_elements(p_hardware_lines) AS line
    JOIN public.inventory_hardware_items AS item
      ON item.id = (line.value->>'item_id')::UUID;

    SELECT jsonb_agg(
      jsonb_build_object(
        'item_id', line.value->>'item_id',
        'from_location_id', v_yard_location_id,
        'to_location_id', v_transfer_location_id,
        'quantity', (line.value->>'quantity')::INTEGER
      )
    )
    INTO v_hardware_transfer_lines
    FROM jsonb_array_elements(p_hardware_lines) AS line;
  END IF;

  v_title := 'Allocate yard take: ' || LEFT(v_details, 80);

  INSERT INTO public.reminder_actions (
    id,
    workflow_key,
    source_type,
    dedupe_key,
    status,
    priority,
    title,
    description,
    metadata,
    created_by
  )
  VALUES (
    v_action_id,
    'inventory_kiosk_unallocated_take',
    'system_generated',
    'inventory_kiosk_unallocated_take:' || v_kiosk_batch_id::TEXT,
    'open',
    'medium',
    v_title,
    v_details,
    jsonb_build_object(
      'location_details', v_details,
      'kiosk_batch_id', v_kiosk_batch_id,
      'transfer_location_id', v_transfer_location_id,
      'serialized_items', v_serialized_snapshot,
      'hardware_lines', v_hardware_snapshot
    ),
    p_actor
  );

  INSERT INTO public.inventory_kiosk_transfer_batches (
    id,
    direction,
    yard_location_id,
    counterpart_location_id,
    location_details,
    reminder_action_id,
    allocation_status,
    note,
    created_by
  )
  VALUES (
    v_kiosk_batch_id,
    'take',
    v_yard_location_id,
    v_transfer_location_id,
    v_details,
    v_action_id,
    'pending',
    NULLIF(BTRIM(COALESCE(p_note, '')), ''),
    p_actor
  );

  IF v_serialized_count > 0 THEN
    INSERT INTO public.inventory_item_movement_batches (
      move_scope,
      destination_location_id,
      note,
      moved_by
    )
    VALUES (
      'kiosk',
      v_transfer_location_id,
      v_details,
      p_actor
    )
    RETURNING id INTO v_movement_batch_id;

    SELECT COUNT(*)::INTEGER
    INTO v_moved_count
    FROM public.inventory_transfer_items(
      p_serialized_item_ids,
      v_transfer_location_id,
      p_location_details,
      p_actor,
      v_movement_batch_id
    );

    IF v_moved_count <> v_serialized_count THEN
      RAISE EXCEPTION 'Serialized Inventory basket changed before it could be committed';
    END IF;
  END IF;

  IF v_hardware_count > 0 THEN
    SELECT public.inventory_transfer_hardware_stock(
      v_hardware_transfer_lines,
      v_details,
      p_actor
    )
    INTO v_hardware_batch_id;
  END IF;

  UPDATE public.inventory_kiosk_transfer_batches
  SET movement_batch_id = v_movement_batch_id,
      hardware_batch_id = v_hardware_batch_id
  WHERE id = v_kiosk_batch_id;

  RETURN QUERY
  SELECT
    v_kiosk_batch_id,
    v_movement_batch_id,
    v_hardware_batch_id,
    v_action_id,
    v_moved_count,
    v_hardware_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.inventory_allocate_unallocated_kiosk_take(
  p_actor UUID,
  p_action_id UUID,
  p_destination_location_id UUID,
  p_new_location JSONB
)
RETURNS TABLE(
  kiosk_batch_id UUID,
  allocated_location_id UUID,
  allocation_movement_batch_id UUID,
  allocation_hardware_batch_id UUID,
  created_location BOOLEAN
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_action public.reminder_actions%ROWTYPE;
  v_batch public.inventory_kiosk_transfer_batches%ROWTYPE;
  v_transfer_location_id UUID;
  v_destination_id UUID;
  v_created BOOLEAN := FALSE;
  v_linked_type TEXT;
  v_linked_id UUID;
  v_name TEXT;
  v_description TEXT;
  v_serialized_ids UUID[] := ARRAY[]::UUID[];
  v_hardware_lines JSONB := '[]'::JSONB;
  v_serialized_count INTEGER := 0;
  v_hardware_count INTEGER := 0;
  v_moved_count INTEGER := 0;
  v_movement_batch_id UUID;
  v_hardware_batch_id UUID;
  v_destination_name TEXT;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Allocation actor is required';
  END IF;

  IF (p_destination_location_id IS NULL) = (p_new_location IS NULL OR p_new_location = 'null'::JSONB) THEN
    RAISE EXCEPTION 'Provide exactly one existing destination or a new location';
  END IF;

  SELECT *
  INTO v_action
  FROM public.reminder_actions
  WHERE id = p_action_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Yard transfer action not found';
  END IF;

  IF v_action.workflow_key <> 'inventory_kiosk_unallocated_take' THEN
    RAISE EXCEPTION 'Action is not a Yard transfer allocation';
  END IF;

  SELECT *
  INTO v_batch
  FROM public.inventory_kiosk_transfer_batches
  WHERE reminder_action_id = p_action_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Yard transfer batch not found';
  END IF;

  IF v_action.status = 'resolved' OR v_batch.allocation_status = 'allocated' THEN
    RAISE EXCEPTION 'Yard take already allocated:%', v_batch.allocated_location_id;
  END IF;

  IF v_action.status <> 'open' OR v_batch.allocation_status <> 'pending' THEN
    RAISE EXCEPTION 'Yard transfer is not waiting for allocation';
  END IF;

  v_transfer_location_id := private.inventory_require_transfer_location();
  IF v_batch.counterpart_location_id <> v_transfer_location_id THEN
    RAISE EXCEPTION 'Yard transfer batch is not held at In transfer';
  END IF;

  PERFORM set_config('inventory.transfer_mutation', 'kiosk_allocate', TRUE);
  PERFORM set_config('inventory.kiosk_action_lifecycle', 'allocate', TRUE);

  IF p_new_location IS NOT NULL AND p_new_location <> 'null'::JSONB THEN
    IF jsonb_typeof(p_new_location) <> 'object' THEN
      RAISE EXCEPTION 'New location details are invalid';
    END IF;

    v_name := BTRIM(COALESCE(p_new_location->>'name', ''));
    v_linked_type := COALESCE(NULLIF(BTRIM(p_new_location->>'linked_asset_type'), ''), 'none');
    v_linked_id := NULLIF(p_new_location->>'linked_asset_id', '')::UUID;
    v_description := NULLIF(BTRIM(COALESCE(p_new_location->>'description', v_batch.location_details)), '');

    IF char_length(v_name) < 1 OR char_length(v_name) > 120 THEN
      RAISE EXCEPTION 'A location name is required';
    END IF;
    IF LOWER(v_name) IN ('yard', 'unknown', 'in transfer') THEN
      RAISE EXCEPTION 'That location name is reserved';
    END IF;
    IF v_linked_type NOT IN ('none', 'van', 'hgv', 'plant') THEN
      RAISE EXCEPTION 'Linked asset type is invalid';
    END IF;

    IF v_linked_type = 'none' THEN
      INSERT INTO public.inventory_locations (
        name,
        description,
        location_type,
        source_type,
        sync_status,
        created_by,
        updated_by
      )
      VALUES (
        v_name,
        v_description,
        'manual',
        'manual',
        'manual',
        p_actor,
        p_actor
      )
      RETURNING id INTO v_destination_id;
    ELSE
      IF v_linked_id IS NULL THEN
        RAISE EXCEPTION 'A linked fleet asset is required';
      END IF;

      IF v_linked_type = 'van' THEN
        IF NOT EXISTS (SELECT 1 FROM public.vans WHERE id = v_linked_id) THEN
          RAISE EXCEPTION 'Linked fleet asset was not found';
        END IF;
      ELSIF v_linked_type = 'hgv' THEN
        IF NOT EXISTS (SELECT 1 FROM public.hgvs WHERE id = v_linked_id) THEN
          RAISE EXCEPTION 'Linked fleet asset was not found';
        END IF;
      ELSIF NOT EXISTS (SELECT 1 FROM public.plant WHERE id = v_linked_id) THEN
        RAISE EXCEPTION 'Linked fleet asset was not found';
      END IF;

      INSERT INTO public.inventory_locations (
        name,
        description,
        location_type,
        source_type,
        sync_status,
        linked_van_id,
        linked_hgv_id,
        linked_plant_id,
        created_by,
        updated_by
      )
      VALUES (
        v_name,
        v_description,
        v_linked_type,
        'fleet',
        'needs_review',
        CASE WHEN v_linked_type = 'van' THEN v_linked_id ELSE NULL END,
        CASE WHEN v_linked_type = 'hgv' THEN v_linked_id ELSE NULL END,
        CASE WHEN v_linked_type = 'plant' THEN v_linked_id ELSE NULL END,
        p_actor,
        p_actor
      )
      RETURNING id INTO v_destination_id;
    END IF;

    v_created := TRUE;
  ELSE
    v_destination_id := p_destination_location_id;
  END IF;

  PERFORM 1
  FROM public.inventory_locations
  WHERE id = v_destination_id
  FOR UPDATE;

  IF NOT EXISTS (
    SELECT 1
    FROM public.inventory_locations
    WHERE id = v_destination_id
      AND is_active = TRUE
      AND location_type IN ('van', 'hgv', 'plant', 'site', 'manual')
  ) THEN
    RAISE EXCEPTION 'Destination location is not an allocatable inventory location';
  END IF;

  SELECT name
  INTO v_destination_name
  FROM public.inventory_locations
  WHERE id = v_destination_id;

  IF v_batch.movement_batch_id IS NOT NULL THEN
    SELECT COALESCE(array_agg(movement.item_id ORDER BY movement.item_id), ARRAY[]::UUID[])
    INTO v_serialized_ids
    FROM public.inventory_item_movements AS movement
    WHERE movement.movement_batch_id = v_batch.movement_batch_id
      AND movement.to_location_id = v_transfer_location_id;
  END IF;

  v_serialized_count := COALESCE(cardinality(v_serialized_ids), 0);

  IF v_batch.hardware_batch_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'item_id', txn.hardware_item_id,
        'from_location_id', v_transfer_location_id,
        'to_location_id', v_destination_id,
        'quantity', txn.quantity_delta
      )
      ORDER BY txn.hardware_item_id
    ), '[]'::JSONB)
    INTO v_hardware_lines
    FROM public.inventory_hardware_transactions AS txn
    WHERE txn.batch_id = v_batch.hardware_batch_id
      AND txn.location_id = v_transfer_location_id
      AND txn.quantity_delta > 0;
  END IF;

  v_hardware_count := COALESCE(jsonb_array_length(v_hardware_lines), 0);

  IF v_serialized_count = 0 AND v_hardware_count = 0 THEN
    RAISE EXCEPTION 'Yard transfer batch has no stock to allocate';
  END IF;

  IF v_serialized_count > 0 THEN
    PERFORM item.id
    FROM public.inventory_items AS item
    WHERE item.id = ANY(v_serialized_ids)
    ORDER BY item.id
    FOR UPDATE;

    IF v_serialized_count <> (
      SELECT COUNT(*)::INTEGER
      FROM public.inventory_items AS item
      WHERE item.id = ANY(v_serialized_ids)
        AND item.status = 'active'
        AND item.location_id = v_transfer_location_id
    ) THEN
      RAISE EXCEPTION 'One or more serialized items are no longer at In transfer';
    END IF;
  END IF;

  IF v_hardware_count > 0 THEN
    PERFORM balance.id
    FROM public.inventory_hardware_balances AS balance
    JOIN jsonb_array_elements(v_hardware_lines) AS line
      ON balance.hardware_item_id = (line.value->>'item_id')::UUID
    WHERE balance.location_id = v_transfer_location_id
    ORDER BY balance.hardware_item_id
    FOR UPDATE OF balance;

    IF v_hardware_count <> (
      SELECT COUNT(*)::INTEGER
      FROM jsonb_array_elements(v_hardware_lines) AS line
      JOIN public.inventory_hardware_balances AS balance
        ON balance.hardware_item_id = (line.value->>'item_id')::UUID
        AND balance.location_id = v_transfer_location_id
        AND balance.quantity >= (line.value->>'quantity')::INTEGER
    ) THEN
      RAISE EXCEPTION 'One or more Hardware quantities are no longer at In transfer';
    END IF;
  END IF;

  IF v_serialized_count > 0 THEN
    INSERT INTO public.inventory_item_movement_batches (
      move_scope,
      destination_location_id,
      note,
      moved_by
    )
    VALUES (
      'kiosk_allocate',
      v_destination_id,
      v_batch.location_details,
      p_actor
    )
    RETURNING id INTO v_movement_batch_id;

    SELECT COUNT(*)::INTEGER
    INTO v_moved_count
    FROM public.inventory_transfer_items(
      v_serialized_ids,
      v_destination_id,
      v_batch.location_details,
      p_actor,
      v_movement_batch_id
    );

    IF v_moved_count <> v_serialized_count THEN
      RAISE EXCEPTION 'Serialized Inventory basket changed before it could be allocated';
    END IF;
  END IF;

  IF v_hardware_count > 0 THEN
    SELECT public.inventory_transfer_hardware_stock(
      v_hardware_lines,
      v_batch.location_details,
      p_actor
    )
    INTO v_hardware_batch_id;
  END IF;

  UPDATE public.inventory_kiosk_transfer_batches
  SET allocation_status = 'allocated',
      allocated_location_id = v_destination_id,
      allocation_movement_batch_id = v_movement_batch_id,
      allocation_hardware_batch_id = v_hardware_batch_id,
      allocated_by = p_actor,
      allocated_at = NOW()
  WHERE id = v_batch.id;

  UPDATE public.reminder_actions
  SET status = 'resolved',
      resolved_by = p_actor,
      resolved_at = NOW(),
      metadata = COALESCE(metadata, '{}'::JSONB) || jsonb_build_object(
        'allocated_location_id', v_destination_id,
        'allocated_location_name', v_destination_name
      )
  WHERE id = v_action.id;

  RETURN QUERY
  SELECT
    v_batch.id,
    v_destination_id,
    v_movement_batch_id,
    v_hardware_batch_id,
    v_created;
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
REVOKE ALL ON FUNCTION public.inventory_kiosk_execute_transfer_basket(
  UUID, TEXT, UUID, UUID[], JSONB, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inventory_kiosk_execute_unallocated_take(
  UUID, UUID[], JSONB, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inventory_allocate_unallocated_kiosk_take(
  UUID, UUID, UUID, JSONB
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inventory_transfer_items(
  UUID[], UUID, TEXT, UUID, UUID
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.inventory_kiosk_execute_transfer_basket(
  UUID, TEXT, UUID, UUID[], JSONB, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.inventory_kiosk_execute_unallocated_take(
  UUID, UUID[], JSONB, TEXT, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.inventory_allocate_unallocated_kiosk_take(
  UUID, UUID, UUID, JSONB
) TO service_role;
GRANT EXECUTE ON FUNCTION public.inventory_transfer_items(
  UUID[], UUID, TEXT, UUID, UUID
) TO service_role;

COMMIT;
