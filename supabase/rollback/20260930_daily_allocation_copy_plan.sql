-- Recovery script for 20260930_daily_allocation_copy_plan.sql.
-- Drops the copy RPC and restores the previous request-action constraint.
-- Copied visits, labour, and plant rows are left in place.
BEGIN;

DROP FUNCTION IF EXISTS public.copy_daily_allocation_plan_v2(UUID, DATE, DATE, TEXT, TEXT[], BOOLEAN, INTEGER, INTEGER);

DELETE FROM private.daily_allocation_mutation_requests
WHERE action = 'plan_copy';

ALTER TABLE private.daily_allocation_mutation_requests
  DROP CONSTRAINT IF EXISTS daily_allocation_mutation_requests_action_check;

ALTER TABLE private.daily_allocation_mutation_requests
  ADD CONSTRAINT daily_allocation_mutation_requests_action_check CHECK (
    action IN (
      'convert',
      'visit_upsert',
      'visit_move',
      'visit_delete',
      'labour_assign',
      'labour_unassign',
      'plant_assign',
      'plant_unassign',
      'override_create',
      'publish'
    )
  );

COMMIT;
