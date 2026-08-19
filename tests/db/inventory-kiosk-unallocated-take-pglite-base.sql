-- Isolated Yard unallocated-take PGlite fixture. Do not apply to production.
-- Enough inventory/Actions schema for the live take and allocate RPCs.

DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY,
  full_name TEXT
);

CREATE TABLE public.vans (
  id UUID PRIMARY KEY,
  reg_number TEXT,
  nickname TEXT,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE public.hgvs (
  id UUID PRIMARY KEY,
  reg_number TEXT,
  nickname TEXT,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE public.plant (
  id UUID PRIMARY KEY,
  plant_id TEXT,
  reg_number TEXT,
  nickname TEXT,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE public.inventory_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  linked_van_id UUID REFERENCES public.vans(id),
  linked_hgv_id UUID REFERENCES public.hgvs(id),
  linked_plant_id UUID REFERENCES public.plant(id),
  location_type TEXT NOT NULL,
  source_type TEXT,
  source_id TEXT,
  external_reference TEXT,
  sync_status TEXT NOT NULL DEFAULT 'manual',
  source_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id),
  updated_by UUID REFERENCES public.profiles(id),
  CONSTRAINT inventory_locations_location_type_check
    CHECK (location_type IN ('yard', 'unknown', 'van', 'hgv', 'plant', 'site', 'manual'))
);

CREATE TABLE public.inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_number TEXT NOT NULL,
  item_number_normalized TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'small_tools',
  location_id UUID NOT NULL REFERENCES public.inventory_locations(id),
  last_checked_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active',
  source TEXT,
  source_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id),
  updated_by UUID REFERENCES public.profiles(id),
  check_interval_days INTEGER,
  retired_at TIMESTAMPTZ,
  retire_reason TEXT,
  retired_by UUID REFERENCES public.profiles(id),
  CONSTRAINT inventory_items_status_check CHECK (status IN ('active', 'retired'))
);

CREATE TABLE public.inventory_item_movement_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  move_scope TEXT NOT NULL DEFAULT 'single',
  group_id UUID,
  destination_location_id UUID NOT NULL REFERENCES public.inventory_locations(id),
  note TEXT,
  moved_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventory_item_movement_batches_scope_check
    CHECK (move_scope IN ('single', 'bulk', 'group', 'claim', 'kiosk'))
);

CREATE TABLE public.inventory_item_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES public.inventory_items(id),
  from_location_id UUID REFERENCES public.inventory_locations(id),
  to_location_id UUID NOT NULL REFERENCES public.inventory_locations(id),
  note TEXT,
  moved_by UUID REFERENCES public.profiles(id),
  moved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  movement_batch_id UUID REFERENCES public.inventory_item_movement_batches(id)
);

CREATE TABLE public.inventory_hardware_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  name_normalized TEXT GENERATED ALWAYS AS (LOWER(BTRIM(name))) STORED,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id),
  updated_by UUID REFERENCES public.profiles(id)
);

CREATE TABLE public.inventory_hardware_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hardware_item_id UUID NOT NULL REFERENCES public.inventory_hardware_items(id),
  location_id UUID NOT NULL REFERENCES public.inventory_locations(id),
  quantity INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id),
  updated_by UUID REFERENCES public.profiles(id),
  UNIQUE (hardware_item_id, location_id)
);

CREATE TABLE public.inventory_hardware_transaction_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_type TEXT NOT NULL,
  reason TEXT NOT NULL,
  note TEXT,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.inventory_hardware_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.inventory_hardware_transaction_batches(id),
  hardware_item_id UUID NOT NULL REFERENCES public.inventory_hardware_items(id),
  location_id UUID NOT NULL REFERENCES public.inventory_locations(id),
  transfer_location_id UUID REFERENCES public.inventory_locations(id),
  quantity_delta INTEGER NOT NULL,
  quantity_before INTEGER NOT NULL,
  quantity_after INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.reminder_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_key TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'system_generated',
  dedupe_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL DEFAULT 'medium',
  title TEXT NOT NULL,
  description TEXT,
  asset_type TEXT,
  van_id UUID REFERENCES public.vans(id),
  plant_id UUID REFERENCES public.plant(id),
  hgv_id UUID REFERENCES public.hgvs(id),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_by UUID REFERENCES public.profiles(id),
  resolved_by UUID REFERENCES public.profiles(id),
  first_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ignored_until TIMESTAMPTZ,
  ignored_forever BOOLEAN NOT NULL DEFAULT FALSE,
  ignored_at TIMESTAMPTZ,
  ignored_by UUID REFERENCES public.profiles(id)
);

CREATE TABLE public.reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id UUID NOT NULL REFERENCES public.reminder_actions(id),
  assigned_to UUID NOT NULL REFERENCES public.profiles(id),
  assigned_by UUID REFERENCES public.profiles(id),
  status TEXT NOT NULL DEFAULT 'pending',
  action_note TEXT,
  actioned_at TIMESTAMPTZ,
  actioned_by UUID REFERENCES public.profiles(id),
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.inventory_kiosk_config (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  kiosk_user_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id),
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  note TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.profiles(id),
  CONSTRAINT inventory_kiosk_config_singleton_check CHECK (id = 1)
);

CREATE TABLE public.inventory_kiosk_transfer_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction TEXT NOT NULL,
  yard_location_id UUID NOT NULL REFERENCES public.inventory_locations(id),
  counterpart_location_id UUID NOT NULL REFERENCES public.inventory_locations(id),
  movement_batch_id UUID REFERENCES public.inventory_item_movement_batches(id),
  hardware_batch_id UUID REFERENCES public.inventory_hardware_transaction_batches(id),
  note TEXT,
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventory_kiosk_transfer_batches_direction_check
    CHECK (direction IN ('take', 'return')),
  CONSTRAINT inventory_kiosk_transfer_batches_locations_check
    CHECK (yard_location_id <> counterpart_location_id)
);

CREATE TABLE public.inventory_user_locations (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id),
  location_id UUID NOT NULL REFERENCES public.inventory_locations(id),
  change_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.profiles(id)
);

CREATE TABLE public.inventory_user_site_locations (
  user_id UUID NOT NULL REFERENCES public.profiles(id),
  location_id UUID NOT NULL REFERENCES public.inventory_locations(id),
  assigned_by UUID REFERENCES public.profiles(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note TEXT,
  PRIMARY KEY (user_id, location_id)
);

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
