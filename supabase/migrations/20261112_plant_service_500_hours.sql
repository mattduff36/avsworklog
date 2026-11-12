-- finalise-phase: predeploy
-- Owner authorised all Plant assets at 500 hours, including due/overdue assets.
-- A missing last-service reading is not evidence of a service at zero hours.
SET LOCAL lock_timeout = '5s';

CREATE TABLE public.plant_service_intervals (
  plant_id uuid PRIMARY KEY REFERENCES public.plant(id) ON DELETE CASCADE,
  interval_hours integer NOT NULL CHECK (interval_hours > 0 AND interval_hours <= 1000000),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.plant_service_intervals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.plant_service_intervals FROM anon, authenticated;
COMMENT ON TABLE public.plant_service_intervals IS 'Optional Plant service interval override; absent row uses service_plant global interval. Manager API only.';

DO $$
DECLARE
  category_id uuid;
BEGIN
  SELECT id INTO STRICT category_id
  FROM public.maintenance_categories
  WHERE config_key = 'service_plant' AND is_active
  FOR UPDATE;

  -- Same lock order as service completion: configuration, then maintenance rows.
  PERFORM id FROM public.vehicle_maintenance
  WHERE plant_id IS NOT NULL ORDER BY id FOR UPDATE;

  CREATE TEMP TABLE plant_service_500_targets ON COMMIT DROP AS
  SELECT id, plant_id, last_service_hours, next_service_hours,
         last_service_hours + 500 AS corrected_due
  FROM public.vehicle_maintenance
  WHERE plant_id IS NOT NULL AND last_service_hours IS NOT NULL
    AND next_service_hours IS DISTINCT FROM last_service_hours + 500;

  UPDATE public.maintenance_categories
  SET period_value = 500, period_unit = 'hours', updated_at = now()
  WHERE id = category_id AND (period_value IS DISTINCT FROM 500 OR period_unit IS DISTINCT FROM 'hours');

  INSERT INTO public.maintenance_history
    (plant_id, maintenance_category_id, field_name, old_value, new_value, value_type, comment)
  SELECT plant_id, category_id, 'next_service_hours', next_service_hours::text,
         corrected_due::text, 'text',
         'Owner-authorised Plant interval correction to 500 hours from recorded last service (20261112_plant_service_500_hours).'
  FROM plant_service_500_targets;

  UPDATE public.vehicle_maintenance m
  SET next_service_hours = t.corrected_due, updated_at = now()
  FROM plant_service_500_targets t WHERE m.id = t.id;

  IF EXISTS (
    SELECT 1 FROM public.vehicle_maintenance
    WHERE plant_id IS NOT NULL AND last_service_hours IS NOT NULL
      AND next_service_hours IS DISTINCT FROM last_service_hours + 500
  ) THEN
    RAISE EXCEPTION 'Plant 500-hour service correction postcondition failed';
  END IF;
END;
$$;
