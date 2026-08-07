-- Small Tools check interval defaults (6 months) with CAT/GENNY 12-month exceptions.
-- Minor Plant remains 1 month when check_interval_days is NULL.
-- Also applies obvious Small Tools name spelling standardisation.

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.inventory_small_tools_interval_backfill_20260807 (
  item_id UUID PRIMARY KEY,
  previous_check_interval_days INTEGER,
  previous_name TEXT NOT NULL,
  applied_check_interval_days INTEGER NOT NULL,
  applied_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION private.normalize_obvious_inventory_item_name(p_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_next TEXT := BTRIM(COALESCE(p_name, ''));
BEGIN
  IF v_next = '' THEN
    RETURN v_next;
  END IF;

  -- Longer typo first so GENNEY is not partially rewritten by GENY.
  v_next := regexp_replace(v_next, '(^|[^A-Za-z0-9])GENNEY(?=[^A-Za-z0-9]|$)', E'\\1GENNY', 'gi');
  v_next := regexp_replace(v_next, '(^|[^A-Za-z0-9])GENY(?=[^A-Za-z0-9]|$)', E'\\1GENNY', 'gi');
  v_next := regexp_replace(v_next, '(^|[^A-Za-z0-9])LAZER(?=[^A-Za-z0-9]|$)', E'\\1LASER', 'gi');
  v_next := regexp_replace(v_next, '(^|[^A-Za-z0-9])STHIL(?=[^A-Za-z0-9]|$)', E'\\1STIHL', 'gi');
  v_next := regexp_replace(v_next, '(^|[^A-Za-z0-9])CAT4(?=[^A-Za-z0-9]|$)', E'\\1CAT 4', 'gi');
  v_next := regexp_replace(v_next, '(^|[^A-Za-z0-9])e CAT 4(?=[^A-Za-z0-9]|$)', E'\\1CAT 4 E', 'gi');
  v_next := regexp_replace(v_next, '(^|[^A-Za-z0-9])circle saw(?=[^A-Za-z0-9]|$)', E'\\1CIRCULAR SAW', 'gi');

  -- Slash spacing: "GENNY /CAT" -> "GENNY / CAT"
  v_next := regexp_replace(v_next, '/(?=\S)', '/ ', 'g');
  v_next := regexp_replace(v_next, '\s+', ' ', 'g');
  v_next := BTRIM(v_next);

  IF v_next <> '' AND v_next = lower(v_next) AND v_next <> upper(v_next) THEN
    v_next := upper(v_next);
  END IF;

  RETURN v_next;
END;
$$;

DO $$
DECLARE
  v_exception_numbers TEXT[] := ARRAY[
    'AVS569',
    'AVS572/571',
    'AVS694',
    'AVS695',
    'AVS708',
    'AVS710',
    'AVS719',
    'AVS720',
    'AVS721',
    'AVS726',
    'AVS795',
    'AVS796',
    'AVS849',
    'AVS866',
    'AVS893',
    'AVS966',
    'AVS967',
    'AVS983984'
  ];
  v_missing_count INTEGER;
  v_minor_plant_changed INTEGER;
  v_null_or_30_count INTEGER;
  v_bad_exception_count INTEGER;
  v_bad_other_count INTEGER;
  v_snapshot_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM private.inventory_small_tools_interval_backfill_20260807
    LIMIT 1
  )
  INTO v_snapshot_exists;

  SELECT COUNT(*)::INTEGER
  INTO v_missing_count
  FROM unnest(v_exception_numbers) AS expected(item_number_normalized)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.inventory_items AS item
    WHERE item.item_number_normalized = expected.item_number_normalized
      AND item.category IS DISTINCT FROM 'minor_plant'
  );

  IF v_missing_count > 0 THEN
    RAISE EXCEPTION
      'Small Tools 12-month exception allowlist missing % item_number_normalized value(s)',
      v_missing_count;
  END IF;

  IF NOT v_snapshot_exists THEN
    INSERT INTO private.inventory_small_tools_interval_backfill_20260807 (
      item_id,
      previous_check_interval_days,
      previous_name,
      applied_check_interval_days,
      applied_name
    )
    SELECT
      item.id,
      item.check_interval_days,
      item.name,
      CASE
        WHEN item.item_number_normalized = ANY (v_exception_numbers) THEN 360
        ELSE 180
      END AS applied_check_interval_days,
      private.normalize_obvious_inventory_item_name(item.name) AS applied_name
    FROM public.inventory_items AS item
    WHERE item.category IS DISTINCT FROM 'minor_plant'
      AND (
        item.check_interval_days IS DISTINCT FROM (
          CASE
            WHEN item.item_number_normalized = ANY (v_exception_numbers) THEN 360
            ELSE 180
          END
        )
        OR item.name IS DISTINCT FROM private.normalize_obvious_inventory_item_name(item.name)
      );
  END IF;

  UPDATE public.inventory_items AS item
  SET
    check_interval_days = CASE
      WHEN item.item_number_normalized = ANY (v_exception_numbers) THEN 360
      ELSE 180
    END,
    name = private.normalize_obvious_inventory_item_name(item.name),
    updated_at = timezone('utc', now())
  WHERE item.category IS DISTINCT FROM 'minor_plant'
    AND (
      item.check_interval_days IS DISTINCT FROM (
        CASE
          WHEN item.item_number_normalized = ANY (v_exception_numbers) THEN 360
          ELSE 180
        END
      )
      OR item.name IS DISTINCT FROM private.normalize_obvious_inventory_item_name(item.name)
    );

  SELECT COUNT(*)::INTEGER
  INTO v_minor_plant_changed
  FROM public.inventory_items AS item
  WHERE item.category = 'minor_plant'
    AND item.check_interval_days IS NOT NULL;

  IF v_minor_plant_changed > 0 THEN
    RAISE EXCEPTION 'Minor Plant check_interval_days must remain NULL; found % non-null row(s)', v_minor_plant_changed;
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_null_or_30_count
  FROM public.inventory_items AS item
  WHERE item.category IS DISTINCT FROM 'minor_plant'
    AND (item.check_interval_days IS NULL OR item.check_interval_days = 30);

  IF v_null_or_30_count > 0 THEN
    RAISE EXCEPTION 'Expected no Small Tools rows with NULL or 30-day intervals; found %', v_null_or_30_count;
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_bad_exception_count
  FROM public.inventory_items AS item
  WHERE item.category IS DISTINCT FROM 'minor_plant'
    AND item.item_number_normalized = ANY (v_exception_numbers)
    AND item.check_interval_days IS DISTINCT FROM 360;

  IF v_bad_exception_count > 0 THEN
    RAISE EXCEPTION 'Expected all Small Tools exceptions at 360 days; found % mismatch(es)', v_bad_exception_count;
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_bad_other_count
  FROM public.inventory_items AS item
  WHERE item.category IS DISTINCT FROM 'minor_plant'
    AND item.item_number_normalized <> ALL (v_exception_numbers)
    AND item.check_interval_days IS DISTINCT FROM 180;

  IF v_bad_other_count > 0 THEN
    RAISE EXCEPTION 'Expected non-exception Small Tools at 180 days; found % mismatch(es)', v_bad_other_count;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.inventory_record_check(
  p_item_id UUID,
  p_checked_at DATE,
  p_checked_by UUID,
  p_note TEXT DEFAULT NULL,
  p_checklist_version TEXT DEFAULT NULL,
  p_checklist_items JSONB DEFAULT NULL,
  p_overall_status TEXT DEFAULT NULL,
  p_confirm_future_date BOOLEAN DEFAULT FALSE,
  p_submission_id UUID DEFAULT NULL
)
RETURNS SETOF public.inventory_check_history
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item public.inventory_items%ROWTYPE;
  v_interval_days INTEGER;
  v_london_today DATE;
  v_existing public.inventory_check_history%ROWTYPE;
  v_inserted public.inventory_check_history%ROWTYPE;
BEGIN
  IF p_item_id IS NULL THEN
    RAISE EXCEPTION 'Inventory item not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF p_checked_at IS NULL THEN
    RAISE EXCEPTION 'Check date must be in YYYY-MM-DD format' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_checked_by IS NULL THEN
    RAISE EXCEPTION 'Checked by is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_overall_status IS NOT NULL
     AND p_overall_status NOT IN ('pass', 'fail', 'partial') THEN
    RAISE EXCEPTION 'Invalid overall status' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_checklist_items IS NOT NULL
     AND jsonb_typeof(p_checklist_items) <> 'array' THEN
    RAISE EXCEPTION 'Checklist items must be an array' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_london_today := (timezone('Europe/London', now()))::date;
  IF p_checked_at > v_london_today AND COALESCE(p_confirm_future_date, FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'FUTURE_CHECK_CONFIRMATION_REQUIRED'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT item.*
  INTO v_item
  FROM public.inventory_items AS item
  WHERE item.id = p_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory item not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_item.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Retired inventory items cannot be checked'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_submission_id IS NOT NULL THEN
    SELECT history.*
    INTO v_existing
    FROM public.inventory_check_history AS history
    WHERE history.item_id = p_item_id
      AND history.submission_id = p_submission_id;

    IF FOUND THEN
      RETURN NEXT v_existing;
      RETURN;
    END IF;
  END IF;

  v_interval_days := COALESCE(
    v_item.check_interval_days,
    CASE WHEN v_item.category = 'minor_plant' THEN 30 ELSE 180 END
  );
  IF v_interval_days < 1 OR v_interval_days > 3650 THEN
    RAISE EXCEPTION 'Check interval must be between 1 and 3650 days'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO public.inventory_check_history (
    item_id,
    checked_at,
    interval_days,
    note,
    checklist_version,
    checklist_items,
    overall_status,
    checked_by,
    submission_id
  )
  VALUES (
    p_item_id,
    p_checked_at,
    v_interval_days,
    NULLIF(BTRIM(COALESCE(p_note, '')), ''),
    NULLIF(BTRIM(COALESCE(p_checklist_version, '')), ''),
    p_checklist_items,
    p_overall_status,
    p_checked_by,
    p_submission_id
  )
  RETURNING * INTO v_inserted;

  RETURN NEXT v_inserted;
  RETURN;
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
  v_blocked_count INTEGER := 0;
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

    IF p_direction = 'take' THEN
      SELECT COUNT(*)::INTEGER
      INTO v_blocked_count
      FROM public.inventory_items AS item
      WHERE item.id = ANY(p_serialized_item_ids)
        AND (
          item.last_checked_at IS NULL
          OR (
            item.last_checked_at
            + make_interval(
              months => GREATEST(
                1,
                ROUND(
                  COALESCE(
                    item.check_interval_days,
                    CASE WHEN item.category = 'minor_plant' THEN 30 ELSE 180 END
                  )::NUMERIC / 30
                )::INTEGER
              )
            )
          )::DATE < CURRENT_DATE
        );

      IF v_blocked_count > 0 THEN
        RAISE EXCEPTION 'Inventory check required before leaving Yard';
      END IF;
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

REVOKE ALL ON FUNCTION public.inventory_record_check(
  UUID,
  DATE,
  UUID,
  TEXT,
  TEXT,
  JSONB,
  TEXT,
  BOOLEAN,
  UUID
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.inventory_record_check(
  UUID,
  DATE,
  UUID,
  TEXT,
  TEXT,
  JSONB,
  TEXT,
  BOOLEAN,
  UUID
) TO service_role;

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
