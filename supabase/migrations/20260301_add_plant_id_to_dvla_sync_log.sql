-- Add plant_id FK column to dvla_sync_log so that plant asset sync events
-- are persisted in the audit log (matching the van_id / hgv_id columns that
-- already exist).  This is a purely additive, idempotent migration.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'dvla_sync_log'
      AND column_name  = 'plant_id'
  ) THEN
    ALTER TABLE public.dvla_sync_log
      ADD COLUMN plant_id UUID REFERENCES public.plant(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_dvla_sync_log_plant_id
  ON public.dvla_sync_log(plant_id);
