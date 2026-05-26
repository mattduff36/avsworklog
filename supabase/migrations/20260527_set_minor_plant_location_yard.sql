BEGIN;

DO $$
DECLARE
  yard_location_id UUID;
BEGIN
  SELECT id
  INTO yard_location_id
  FROM public.inventory_locations
  WHERE LOWER(BTRIM(name)) = 'yard'
    AND is_active = TRUE
  ORDER BY name
  LIMIT 1;

  IF yard_location_id IS NULL THEN
    RAISE EXCEPTION 'Active inventory location named "Yard" was not found';
  END IF;

  UPDATE public.inventory_items
  SET location_id = yard_location_id,
      updated_at = NOW()
  WHERE status = 'active'
    AND category = 'minor_plant';
END $$;

COMMIT;
