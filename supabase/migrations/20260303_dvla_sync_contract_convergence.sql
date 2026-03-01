-- Converge DVLA sync DB contracts after vans/hgvs/plant split + renames.
-- Safe to run repeatedly across partially migrated environments.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Allow all trigger types currently used by application sync flows.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'dvla_sync_log'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%trigger_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.dvla_sync_log DROP CONSTRAINT %I', rec.conname);
  END LOOP;
END $$;

ALTER TABLE public.dvla_sync_log
  ADD CONSTRAINT check_dvla_sync_log_trigger_type
  CHECK (
    trigger_type IN ('manual', 'bulk', 'automatic', 'auto_on_create')
  );

-- ---------------------------------------------------------------------------
-- 2) Ensure one maintenance row per asset id for each asset type.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS unique_van_maintenance
  ON public.vehicle_maintenance(van_id)
  WHERE van_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS unique_hgv_maintenance
  ON public.vehicle_maintenance(hgv_id)
  WHERE hgv_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS unique_plant_maintenance
  ON public.vehicle_maintenance(plant_id)
  WHERE plant_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3) Update shared-table asset checks to support vans + hgvs + plant.
-- ---------------------------------------------------------------------------
ALTER TABLE public.vehicle_maintenance
  DROP CONSTRAINT IF EXISTS check_maintenance_asset;

ALTER TABLE public.vehicle_maintenance
  ADD CONSTRAINT check_maintenance_asset
  CHECK (num_nonnulls(van_id, hgv_id, plant_id) = 1);

ALTER TABLE public.maintenance_history
  DROP CONSTRAINT IF EXISTS check_maintenance_history_asset;

ALTER TABLE public.maintenance_history
  ADD CONSTRAINT check_maintenance_history_asset
  CHECK (num_nonnulls(van_id, hgv_id, plant_id) = 1);

ALTER TABLE public.actions
  DROP CONSTRAINT IF EXISTS check_actions_asset;

ALTER TABLE public.actions
  ADD CONSTRAINT check_actions_asset
  CHECK (
    num_nonnulls(van_id, hgv_id, plant_id) <= 1
  );

-- ---------------------------------------------------------------------------
-- 4) Re-apply stale rename-dependent objects idempotently.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_vehicle_type_from_category()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.category_id IS NOT NULL THEN
    NEW.vehicle_type := (
      SELECT name
      FROM public.van_categories
      WHERE id = NEW.category_id
    );
  ELSE
    NEW.vehicle_type := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'van_archive'
      AND column_name = 'vehicle_id'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'van_archive'
      AND column_name = 'van_id'
  ) THEN
    ALTER TABLE public.van_archive RENAME COLUMN vehicle_id TO van_id;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.get_latest_mot_test(UUID);
CREATE OR REPLACE FUNCTION public.get_latest_mot_test(p_van_id UUID)
RETURNS SETOF public.mot_test_history AS $$
  SELECT *
  FROM public.mot_test_history
  WHERE van_id = p_van_id
  ORDER BY completed_date DESC
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

DROP FUNCTION IF EXISTS public.get_latest_passed_mot(UUID);
CREATE OR REPLACE FUNCTION public.get_latest_passed_mot(p_van_id UUID)
RETURNS SETOF public.mot_test_history AS $$
  SELECT *
  FROM public.mot_test_history
  WHERE van_id = p_van_id
    AND test_result = 'PASSED'
    AND expiry_date IS NOT NULL
  ORDER BY completed_date DESC
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

COMMIT;
