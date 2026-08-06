BEGIN;

CREATE OR REPLACE FUNCTION private.assert_inventory_item_location_accepts_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_location public.inventory_locations%ROWTYPE;
  v_requires_active BOOLEAN;
BEGIN
  v_requires_active := (
    TG_OP = 'INSERT'
    OR NEW.location_id IS DISTINCT FROM OLD.location_id
    OR (
      NEW.status = 'active'
      AND OLD.status IS DISTINCT FROM 'active'
    )
  );

  IF NOT v_requires_active THEN
    RETURN NEW;
  END IF;

  IF NEW.location_id IS NULL THEN
    RAISE EXCEPTION 'Stock rows require a location_id.';
  END IF;

  SELECT loc.*
  INTO v_location
  FROM public.inventory_locations AS loc
  WHERE loc.id = NEW.location_id
  FOR UPDATE;

  IF v_location.id IS NULL THEN
    RAISE EXCEPTION 'Cannot assign stock to missing location %.', NEW.location_id;
  END IF;

  IF v_location.is_active IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Cannot assign stock to inactive location %.', NEW.location_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.assert_inventory_hardware_location_accepts_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_location public.inventory_locations%ROWTYPE;
  v_requires_active BOOLEAN;
BEGIN
  v_requires_active := (
    TG_OP = 'INSERT'
    OR NEW.location_id IS DISTINCT FROM OLD.location_id
    OR COALESCE(NEW.quantity, 0) > COALESCE(OLD.quantity, 0)
  );

  IF NOT v_requires_active THEN
    RETURN NEW;
  END IF;

  IF NEW.location_id IS NULL THEN
    RAISE EXCEPTION 'Stock rows require a location_id.';
  END IF;

  SELECT loc.*
  INTO v_location
  FROM public.inventory_locations AS loc
  WHERE loc.id = NEW.location_id
  FOR UPDATE;

  IF v_location.id IS NULL THEN
    RAISE EXCEPTION 'Cannot assign stock to missing location %.', NEW.location_id;
  END IF;

  IF v_location.is_active IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Cannot assign stock to inactive location %.', NEW.location_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_items_require_active_location ON public.inventory_items;
CREATE TRIGGER trg_inventory_items_require_active_location
BEFORE INSERT OR UPDATE OF location_id, status ON public.inventory_items
FOR EACH ROW
EXECUTE FUNCTION private.assert_inventory_item_location_accepts_stock();

DROP TRIGGER IF EXISTS trg_inventory_hardware_balances_require_active_location
  ON public.inventory_hardware_balances;
CREATE TRIGGER trg_inventory_hardware_balances_require_active_location
BEFORE INSERT OR UPDATE OF location_id, quantity ON public.inventory_hardware_balances
FOR EACH ROW
EXECUTE FUNCTION private.assert_inventory_hardware_location_accepts_stock();

DROP FUNCTION IF EXISTS private.assert_inventory_location_accepts_stock();

REVOKE ALL ON FUNCTION private.assert_inventory_item_location_accepts_stock() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.assert_inventory_hardware_location_accepts_stock() FROM PUBLIC;

COMMIT;
