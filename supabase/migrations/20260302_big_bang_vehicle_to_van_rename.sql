-- ============================================================
-- Migration: Big-bang vehicle_id -> van_id + table renames
-- ============================================================
-- Renames van-specific foreign keys and table names to align
-- with the vehicles -> vans domain split.

BEGIN;

-- ------------------------------------------------------------
-- 1) Rename van-specific tables
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'vehicle_categories'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'van_categories'
  ) THEN
    ALTER TABLE public.vehicle_categories RENAME TO van_categories;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'vehicle_archive'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'van_archive'
  ) THEN
    ALTER TABLE public.vehicle_archive RENAME TO van_archive;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2) Rename van-specific FK columns from vehicle_id -> van_id
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'actions' AND column_name = 'vehicle_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'actions' AND column_name = 'van_id'
  ) THEN
    ALTER TABLE public.actions RENAME COLUMN vehicle_id TO van_id;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vehicle_maintenance' AND column_name = 'vehicle_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vehicle_maintenance' AND column_name = 'van_id'
  ) THEN
    ALTER TABLE public.vehicle_maintenance RENAME COLUMN vehicle_id TO van_id;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'maintenance_history' AND column_name = 'vehicle_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'maintenance_history' AND column_name = 'van_id'
  ) THEN
    ALTER TABLE public.maintenance_history RENAME COLUMN vehicle_id TO van_id;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'van_inspections' AND column_name = 'vehicle_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'van_inspections' AND column_name = 'van_id'
  ) THEN
    ALTER TABLE public.van_inspections RENAME COLUMN vehicle_id TO van_id;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mot_test_history' AND column_name = 'vehicle_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mot_test_history' AND column_name = 'van_id'
  ) THEN
    ALTER TABLE public.mot_test_history RENAME COLUMN vehicle_id TO van_id;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'dvla_sync_log' AND column_name = 'vehicle_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'dvla_sync_log' AND column_name = 'van_id'
  ) THEN
    ALTER TABLE public.dvla_sync_log RENAME COLUMN vehicle_id TO van_id;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 3) Rename constraints/indexes to match new terminology
-- ------------------------------------------------------------
DO $$
DECLARE
  rec RECORD;
  new_name TEXT;
BEGIN
  -- Rename table constraints (PK/FK/UNIQUE/CHECK) containing vehicle_ or vehicle_id
  FOR rec IN
    SELECT n.nspname AS schema_name, c.relname AS table_name, con.conname AS old_name
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('actions', 'vehicle_maintenance', 'maintenance_history', 'van_inspections', 'mot_test_history', 'dvla_sync_log', 'van_categories', 'van_archive')
      AND (con.conname LIKE '%vehicle_id%' OR con.conname LIKE '%vehicle_%')
  LOOP
    new_name := replace(replace(rec.old_name, 'vehicle_id', 'van_id'), 'vehicle_', 'van_');

    IF new_name <> rec.old_name AND NOT EXISTS (
      SELECT 1
      FROM pg_constraint c2
      JOIN pg_class t2 ON t2.oid = c2.conrelid
      JOIN pg_namespace n2 ON n2.oid = t2.relnamespace
      WHERE n2.nspname = rec.schema_name
        AND t2.relname = rec.table_name
        AND c2.conname = new_name
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I.%I RENAME CONSTRAINT %I TO %I',
        rec.schema_name,
        rec.table_name,
        rec.old_name,
        new_name
      );
    END IF;
  END LOOP;

  -- Rename indexes containing vehicle_ or vehicle_id
  FOR rec IN
    SELECT schemaname AS schema_name, indexname AS old_name
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename IN ('actions', 'vehicle_maintenance', 'maintenance_history', 'van_inspections', 'mot_test_history', 'dvla_sync_log', 'van_categories', 'van_archive')
      AND (indexname LIKE '%vehicle_id%' OR indexname LIKE '%vehicle_%')
  LOOP
    new_name := replace(replace(rec.old_name, 'vehicle_id', 'van_id'), 'vehicle_', 'van_');

    IF new_name <> rec.old_name AND to_regclass(format('%I.%I', rec.schema_name, new_name)) IS NULL THEN
      EXECUTE format(
        'ALTER INDEX %I.%I RENAME TO %I',
        rec.schema_name,
        rec.old_name,
        new_name
      );
    END IF;
  END LOOP;
END $$;

COMMIT;
