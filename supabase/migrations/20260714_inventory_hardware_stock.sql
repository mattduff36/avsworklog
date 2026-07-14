BEGIN;

CREATE TABLE IF NOT EXISTS public.inventory_hardware_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  name_normalized TEXT GENERATED ALWAYS AS (LOWER(BTRIM(name))) STORED,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT inventory_hardware_items_name_not_blank CHECK (BTRIM(name) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_hardware_items_name_normalized_idx
  ON public.inventory_hardware_items (name_normalized);

CREATE INDEX IF NOT EXISTS inventory_hardware_items_active_sort_idx
  ON public.inventory_hardware_items (is_active, sort_order, name);

CREATE TABLE IF NOT EXISTS public.inventory_hardware_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hardware_item_id UUID NOT NULL REFERENCES public.inventory_hardware_items(id) ON DELETE RESTRICT,
  location_id UUID NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT inventory_hardware_balances_quantity_non_negative CHECK (quantity >= 0),
  CONSTRAINT inventory_hardware_balances_item_location_unique UNIQUE (hardware_item_id, location_id)
);

CREATE INDEX IF NOT EXISTS inventory_hardware_balances_location_idx
  ON public.inventory_hardware_balances (location_id, hardware_item_id);

CREATE INDEX IF NOT EXISTS inventory_hardware_balances_positive_idx
  ON public.inventory_hardware_balances (hardware_item_id, location_id)
  WHERE quantity > 0;

CREATE TABLE IF NOT EXISTS public.inventory_hardware_transaction_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_type TEXT NOT NULL,
  reason TEXT NOT NULL,
  note TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventory_hardware_batches_operation_check
    CHECK (operation_type IN ('add', 'remove', 'recount', 'transfer')),
  CONSTRAINT inventory_hardware_batches_reason_check
    CHECK (reason IN (
      'Delivery',
      'Return',
      'Used',
      'Lost',
      'Scrapped',
      'Damaged',
      'Stocktake correction',
      'Other',
      'Transfer'
    )),
  CONSTRAINT inventory_hardware_batches_other_note_check
    CHECK (reason <> 'Other' OR NULLIF(BTRIM(note), '') IS NOT NULL),
  CONSTRAINT inventory_hardware_batches_transfer_reason_check
    CHECK (
      (operation_type = 'transfer' AND reason = 'Transfer')
      OR (operation_type <> 'transfer' AND reason <> 'Transfer')
    )
);

CREATE INDEX IF NOT EXISTS inventory_hardware_batches_created_idx
  ON public.inventory_hardware_transaction_batches (created_at DESC);

CREATE TABLE IF NOT EXISTS public.inventory_hardware_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.inventory_hardware_transaction_batches(id) ON DELETE CASCADE,
  hardware_item_id UUID NOT NULL REFERENCES public.inventory_hardware_items(id) ON DELETE RESTRICT,
  location_id UUID NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  transfer_location_id UUID REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  quantity_delta INTEGER NOT NULL,
  quantity_before INTEGER NOT NULL,
  quantity_after INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventory_hardware_transactions_before_non_negative CHECK (quantity_before >= 0),
  CONSTRAINT inventory_hardware_transactions_after_non_negative CHECK (quantity_after >= 0)
);

CREATE INDEX IF NOT EXISTS inventory_hardware_transactions_item_created_idx
  ON public.inventory_hardware_transactions (hardware_item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS inventory_hardware_transactions_location_created_idx
  ON public.inventory_hardware_transactions (location_id, created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at_inventory_hardware_items ON public.inventory_hardware_items;
CREATE TRIGGER set_updated_at_inventory_hardware_items
  BEFORE UPDATE ON public.inventory_hardware_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at_inventory_hardware_balances ON public.inventory_hardware_balances;
CREATE TRIGGER set_updated_at_inventory_hardware_balances
  BEFORE UPDATE ON public.inventory_hardware_balances
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.inventory_apply_hardware_adjustments(
  p_operation_type TEXT,
  p_reason TEXT,
  p_note TEXT,
  p_lines JSONB,
  p_actor UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_batch_id UUID;
  v_line JSONB;
  v_item_id UUID;
  v_location_id UUID;
  v_quantity INTEGER;
  v_before INTEGER;
  v_after INTEGER;
BEGIN
  IF p_operation_type NOT IN ('add', 'remove', 'recount') THEN
    RAISE EXCEPTION 'Invalid Hardware adjustment operation';
  END IF;

  IF p_reason NOT IN (
    'Delivery',
    'Return',
    'Used',
    'Lost',
    'Scrapped',
    'Damaged',
    'Stocktake correction',
    'Other'
  ) THEN
    RAISE EXCEPTION 'Invalid Hardware adjustment reason';
  END IF;

  IF p_reason = 'Other' AND NULLIF(BTRIM(p_note), '') IS NULL THEN
    RAISE EXCEPTION 'A note is required when the Hardware adjustment reason is Other';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'At least one Hardware adjustment line is required';
  END IF;

  IF jsonb_array_length(p_lines) <> (
    SELECT COUNT(*)
    FROM (
      SELECT DISTINCT value->>'item_id', value->>'location_id'
      FROM jsonb_array_elements(p_lines)
    ) AS distinct_lines
  ) THEN
    RAISE EXCEPTION 'Duplicate Hardware item and location adjustment lines are not allowed';
  END IF;

  INSERT INTO public.inventory_hardware_transaction_batches (
    operation_type,
    reason,
    note,
    created_by
  )
  VALUES (
    p_operation_type,
    p_reason,
    NULLIF(BTRIM(p_note), ''),
    p_actor
  )
  RETURNING id INTO v_batch_id;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_item_id := NULLIF(v_line->>'item_id', '')::UUID;
    v_location_id := NULLIF(v_line->>'location_id', '')::UUID;
    v_quantity := NULLIF(v_line->>'quantity', '')::INTEGER;

    IF v_item_id IS NULL OR v_location_id IS NULL OR v_quantity IS NULL THEN
      RAISE EXCEPTION 'Each Hardware adjustment line requires item_id, location_id, and quantity';
    END IF;

    IF (p_operation_type IN ('add', 'remove') AND v_quantity <= 0)
      OR (p_operation_type = 'recount' AND v_quantity < 0) THEN
      RAISE EXCEPTION 'Hardware quantities must be positive, or zero for a recount';
    END IF;

    PERFORM 1
    FROM public.inventory_hardware_items
    WHERE id = v_item_id
      AND is_active = TRUE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Active Hardware item not found';
    END IF;

    PERFORM 1
    FROM public.inventory_locations
    WHERE id = v_location_id
      AND is_active = TRUE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Active Inventory location not found';
    END IF;

    INSERT INTO public.inventory_hardware_balances (
      hardware_item_id,
      location_id,
      quantity,
      created_by,
      updated_by
    )
    VALUES (v_item_id, v_location_id, 0, p_actor, p_actor)
    ON CONFLICT (hardware_item_id, location_id) DO NOTHING;

    SELECT quantity
    INTO v_before
    FROM public.inventory_hardware_balances
    WHERE hardware_item_id = v_item_id
      AND location_id = v_location_id
    FOR UPDATE;

    v_after := CASE p_operation_type
      WHEN 'add' THEN v_before + v_quantity
      WHEN 'remove' THEN v_before - v_quantity
      ELSE v_quantity
    END;

    IF v_after < 0 THEN
      RAISE EXCEPTION 'Hardware quantity cannot be negative';
    END IF;

    UPDATE public.inventory_hardware_balances
    SET quantity = v_after,
        updated_by = p_actor
    WHERE hardware_item_id = v_item_id
      AND location_id = v_location_id;

    INSERT INTO public.inventory_hardware_transactions (
      batch_id,
      hardware_item_id,
      location_id,
      quantity_delta,
      quantity_before,
      quantity_after
    )
    VALUES (
      v_batch_id,
      v_item_id,
      v_location_id,
      v_after - v_before,
      v_before,
      v_after
    );
  END LOOP;

  RETURN v_batch_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.inventory_transfer_hardware_stock(
  p_lines JSONB,
  p_note TEXT,
  p_actor UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_batch_id UUID;
  v_line JSONB;
  v_item_id UUID;
  v_from_location_id UUID;
  v_to_location_id UUID;
  v_quantity INTEGER;
  v_from_before INTEGER;
  v_to_before INTEGER;
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'At least one Hardware transfer line is required';
  END IF;

  IF jsonb_array_length(p_lines) <> (
    SELECT COUNT(*)
    FROM (
      SELECT DISTINCT
        value->>'item_id',
        value->>'from_location_id',
        value->>'to_location_id'
      FROM jsonb_array_elements(p_lines)
    ) AS distinct_lines
  ) THEN
    RAISE EXCEPTION 'Duplicate Hardware transfer lines are not allowed';
  END IF;

  INSERT INTO public.inventory_hardware_transaction_batches (
    operation_type,
    reason,
    note,
    created_by
  )
  VALUES ('transfer', 'Transfer', NULLIF(BTRIM(p_note), ''), p_actor)
  RETURNING id INTO v_batch_id;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_item_id := NULLIF(v_line->>'item_id', '')::UUID;
    v_from_location_id := NULLIF(v_line->>'from_location_id', '')::UUID;
    v_to_location_id := NULLIF(v_line->>'to_location_id', '')::UUID;
    v_quantity := NULLIF(v_line->>'quantity', '')::INTEGER;

    IF v_item_id IS NULL
      OR v_from_location_id IS NULL
      OR v_to_location_id IS NULL
      OR v_quantity IS NULL THEN
      RAISE EXCEPTION 'Each Hardware transfer line requires item_id, from_location_id, to_location_id, and quantity';
    END IF;

    IF v_quantity <= 0 THEN
      RAISE EXCEPTION 'Hardware transfer quantity must be positive';
    END IF;

    IF v_from_location_id = v_to_location_id THEN
      RAISE EXCEPTION 'Hardware transfer locations must be different';
    END IF;

    PERFORM 1
    FROM public.inventory_hardware_items
    WHERE id = v_item_id
      AND is_active = TRUE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Active Hardware item not found';
    END IF;

    IF (
      SELECT COUNT(*)
      FROM public.inventory_locations
      WHERE id IN (v_from_location_id, v_to_location_id)
        AND is_active = TRUE
    ) <> 2 THEN
      RAISE EXCEPTION 'Both Hardware transfer locations must be active';
    END IF;

    INSERT INTO public.inventory_hardware_balances (
      hardware_item_id,
      location_id,
      quantity,
      created_by,
      updated_by
    )
    VALUES
      (v_item_id, v_from_location_id, 0, p_actor, p_actor),
      (v_item_id, v_to_location_id, 0, p_actor, p_actor)
    ON CONFLICT (hardware_item_id, location_id) DO NOTHING;

    PERFORM 1
    FROM public.inventory_hardware_balances
    WHERE hardware_item_id = v_item_id
      AND location_id IN (v_from_location_id, v_to_location_id)
    ORDER BY location_id
    FOR UPDATE;

    SELECT quantity
    INTO v_from_before
    FROM public.inventory_hardware_balances
    WHERE hardware_item_id = v_item_id
      AND location_id = v_from_location_id;

    SELECT quantity
    INTO v_to_before
    FROM public.inventory_hardware_balances
    WHERE hardware_item_id = v_item_id
      AND location_id = v_to_location_id;

    IF v_from_before < v_quantity THEN
      RAISE EXCEPTION 'Insufficient Hardware stock at source location';
    END IF;

    UPDATE public.inventory_hardware_balances
    SET quantity = v_from_before - v_quantity,
        updated_by = p_actor
    WHERE hardware_item_id = v_item_id
      AND location_id = v_from_location_id;

    UPDATE public.inventory_hardware_balances
    SET quantity = v_to_before + v_quantity,
        updated_by = p_actor
    WHERE hardware_item_id = v_item_id
      AND location_id = v_to_location_id;

    INSERT INTO public.inventory_hardware_transactions (
      batch_id,
      hardware_item_id,
      location_id,
      transfer_location_id,
      quantity_delta,
      quantity_before,
      quantity_after
    )
    VALUES
      (
        v_batch_id,
        v_item_id,
        v_from_location_id,
        v_to_location_id,
        -v_quantity,
        v_from_before,
        v_from_before - v_quantity
      ),
      (
        v_batch_id,
        v_item_id,
        v_to_location_id,
        v_from_location_id,
        v_quantity,
        v_to_before,
        v_to_before + v_quantity
      );
  END LOOP;

  RETURN v_batch_id;
END;
$$;

REVOKE ALL ON FUNCTION public.inventory_apply_hardware_adjustments(TEXT, TEXT, TEXT, JSONB, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_apply_hardware_adjustments(TEXT, TEXT, TEXT, JSONB, UUID)
  TO service_role;

REVOKE ALL ON FUNCTION public.inventory_transfer_hardware_stock(JSONB, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_transfer_hardware_stock(JSONB, TEXT, UUID)
  TO service_role;

ALTER TABLE public.inventory_hardware_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_hardware_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_hardware_transaction_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_hardware_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_hardware_items_select ON public.inventory_hardware_items;
CREATE POLICY inventory_hardware_items_select ON public.inventory_hardware_items
  FOR SELECT TO authenticated
  USING (public.effective_has_module_permission('inventory'));

DROP POLICY IF EXISTS inventory_hardware_balances_select ON public.inventory_hardware_balances;
CREATE POLICY inventory_hardware_balances_select ON public.inventory_hardware_balances
  FOR SELECT TO authenticated
  USING (
    public.effective_has_module_permission('inventory')
    AND (
      public.effective_is_manager_admin()
      OR public.effective_is_super_admin()
      OR public.effective_role_class() IN ('admin', 'manager')
      OR (
        quantity > 0
        AND (
          location_id IN (
            SELECT user_location.location_id
            FROM public.inventory_user_locations user_location
            JOIN public.inventory_locations location
              ON location.id = user_location.location_id
            WHERE user_location.user_id = (SELECT auth.uid())
              AND location.is_active = TRUE
              AND location.location_type <> 'site'
          )
          OR location_id IN (
            SELECT site_location.location_id
            FROM public.inventory_user_site_locations site_location
            JOIN public.inventory_locations location
              ON location.id = site_location.location_id
            WHERE site_location.user_id = (SELECT auth.uid())
              AND location.is_active = TRUE
              AND location.location_type = 'site'
          )
        )
      )
    )
  );

DROP POLICY IF EXISTS inventory_hardware_batches_select ON public.inventory_hardware_transaction_batches;
CREATE POLICY inventory_hardware_batches_select ON public.inventory_hardware_transaction_batches
  FOR SELECT TO authenticated
  USING (public.effective_has_module_permission('inventory'));

DROP POLICY IF EXISTS inventory_hardware_transactions_select ON public.inventory_hardware_transactions;
CREATE POLICY inventory_hardware_transactions_select ON public.inventory_hardware_transactions
  FOR SELECT TO authenticated
  USING (public.effective_has_module_permission('inventory'));

INSERT INTO public.inventory_hardware_items (name, sort_order)
VALUES
  ('Heras fencing', 10),
  ('Cones', 20),
  ('Cone tops', 30),
  ('Road plates', 40),
  ('Derv tank', 50),
  ('Machine breaker', 60),
  ('Floor saw', 70),
  ('Generator', 80),
  ('Tamp', 90)
ON CONFLICT (name_normalized) DO UPDATE
SET name = EXCLUDED.name,
    sort_order = EXCLUDED.sort_order;

COMMIT;
