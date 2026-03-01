-- Fix ON CONFLICT upserts for vehicle_maintenance.
--
-- The big-bang rename migration dropped the original full UNIQUE constraint on
-- van_id and the convergence migration replaced it with partial unique indexes
-- (WHERE col IS NOT NULL).  PostgreSQL's ON CONFLICT (column) syntax requires a
-- full unique constraint, not a partial index, so every upsert was failing with:
--   "there is no unique or exclusion constraint matching the ON CONFLICT specification"
--
-- Fix: drop the partial indexes and replace with full unique constraints.
-- In PostgreSQL, NULL values are always distinct for UNIQUE purposes, so multiple
-- rows with van_id = NULL (HGV / plant rows) are allowed by UNIQUE(van_id).

-- Drop partial unique indexes (both names used across different migration runs)
DROP INDEX IF EXISTS public.unique_van_maintenance;
DROP INDEX IF EXISTS public.unique_van_maintenance_id;
DROP INDEX IF EXISTS public.unique_hgv_maintenance;
DROP INDEX IF EXISTS public.unique_plant_maintenance;

-- Also drop any leftover full constraints from earlier migrations, then re-add
-- cleanly so this migration is idempotent.
ALTER TABLE public.vehicle_maintenance DROP CONSTRAINT IF EXISTS unique_vm_van_id;
ALTER TABLE public.vehicle_maintenance DROP CONSTRAINT IF EXISTS unique_vm_hgv_id;
ALTER TABLE public.vehicle_maintenance DROP CONSTRAINT IF EXISTS unique_vm_plant_id;
ALTER TABLE public.vehicle_maintenance DROP CONSTRAINT IF EXISTS unique_vehicle_maintenance;

ALTER TABLE public.vehicle_maintenance ADD CONSTRAINT unique_vm_van_id   UNIQUE (van_id);
ALTER TABLE public.vehicle_maintenance ADD CONSTRAINT unique_vm_hgv_id   UNIQUE (hgv_id);
ALTER TABLE public.vehicle_maintenance ADD CONSTRAINT unique_vm_plant_id UNIQUE (plant_id);
