BEGIN;

CREATE OR REPLACE FUNCTION public.inventory_user_site_locations_validate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_location public.inventory_locations%ROWTYPE;
BEGIN
  SELECT *
  INTO v_location
  FROM public.inventory_locations
  WHERE id = NEW.location_id;

  IF v_location.id IS NULL THEN
    RAISE EXCEPTION 'Inventory location not found';
  END IF;

  IF v_location.location_type NOT IN ('site', 'manual')
    OR v_location.is_active IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Only active Site or Manual locations can be assigned as secondary inventory locations';
  END IF;

  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS inventory_hardware_balances_select
  ON public.inventory_hardware_balances;
CREATE POLICY inventory_hardware_balances_select
  ON public.inventory_hardware_balances
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
            SELECT secondary_location.location_id
            FROM public.inventory_user_site_locations secondary_location
            JOIN public.inventory_locations location
              ON location.id = secondary_location.location_id
            WHERE secondary_location.user_id = (SELECT auth.uid())
              AND location.is_active = TRUE
              AND location.location_type IN ('site', 'manual')
          )
        )
      )
    )
  );

COMMIT;
