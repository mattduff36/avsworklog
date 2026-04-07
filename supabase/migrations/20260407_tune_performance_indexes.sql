BEGIN;

ALTER TABLE public.inspection_items
  DROP CONSTRAINT IF EXISTS inspection_items_inspection_id_item_number_day_key;

DROP INDEX IF EXISTS public.idx_quote_manager_series_initials;

CREATE INDEX IF NOT EXISTS idx_actions_actioned_by ON public.actions(actioned_by);
CREATE INDEX IF NOT EXISTS idx_actions_created_by ON public.actions(created_by);
CREATE INDEX IF NOT EXISTS idx_actions_logged_by ON public.actions(logged_by);
CREATE INDEX IF NOT EXISTS idx_actions_inspection_item_id ON public.actions(inspection_item_id);

CREATE INDEX IF NOT EXISTS idx_absences_approved_by ON public.absences(approved_by);
CREATE INDEX IF NOT EXISTS idx_absences_created_by ON public.absences(created_by);
CREATE INDEX IF NOT EXISTS idx_absences_processed_by ON public.absences(processed_by);

CREATE INDEX IF NOT EXISTS idx_timesheets_adjusted_by ON public.timesheets(adjusted_by);
CREATE INDEX IF NOT EXISTS idx_timesheets_reviewed_by ON public.timesheets(reviewed_by);

CREATE INDEX IF NOT EXISTS idx_van_inspections_reviewed_by ON public.van_inspections(reviewed_by);
CREATE INDEX IF NOT EXISTS idx_rams_assignments_assigned_by ON public.rams_assignments(assigned_by);
CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_last_updated_by ON public.vehicle_maintenance(last_updated_by);

DO $$
DECLARE
  created_indexes integer;
BEGIN
  SELECT COUNT(*)
  INTO created_indexes
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname = ANY (ARRAY[
      'idx_actions_actioned_by',
      'idx_actions_created_by',
      'idx_actions_logged_by',
      'idx_actions_inspection_item_id',
      'idx_absences_approved_by',
      'idx_absences_created_by',
      'idx_absences_processed_by',
      'idx_timesheets_adjusted_by',
      'idx_timesheets_reviewed_by',
      'idx_van_inspections_reviewed_by',
      'idx_rams_assignments_assigned_by',
      'idx_vehicle_maintenance_last_updated_by'
    ]);

  IF created_indexes <> 12 THEN
    RAISE EXCEPTION 'Expected 12 performance indexes to exist, found %', created_indexes;
  END IF;
END $$;

COMMIT;
