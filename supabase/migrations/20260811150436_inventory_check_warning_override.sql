-- Inventory check state is now an application-level warning that users may confirm.
-- Preserve the kiosk transfer transaction and all stock-integrity checks while removing
-- only the database hard stop for lapsed inventory checks.

BEGIN;

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
      AND location_type <> 'yard'
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

REVOKE ALL ON FUNCTION public.inventory_kiosk_execute_transfer_basket(
  UUID,
  TEXT,
  UUID,
  UUID[],
  JSONB,
  TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.inventory_kiosk_execute_transfer_basket(
  UUID,
  TEXT,
  UUID,
  UUID[],
  JSONB,
  TEXT
) TO service_role;

COMMIT;
