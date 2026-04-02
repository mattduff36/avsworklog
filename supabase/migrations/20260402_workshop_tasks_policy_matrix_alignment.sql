-- Align workshop task action policies with primary permissions matrix
-- PRD: docs/PRD_WORKSHOP_TASKS.md

BEGIN;

DROP POLICY IF EXISTS "Workshop users can view workshop tasks" ON actions;
DROP POLICY IF EXISTS "Workshop users can update workshop tasks" ON actions;
DROP POLICY IF EXISTS "Workshop users can create workshop tasks" ON actions;

CREATE POLICY "Workshop users can view workshop tasks" ON actions
  FOR SELECT TO authenticated
  USING (
    action_type IN ('inspection_defect', 'workshop_vehicle_task')
    AND effective_has_module_permission('workshop-tasks')
  );

CREATE POLICY "Workshop users can update workshop tasks" ON actions
  FOR UPDATE TO authenticated
  USING (
    action_type IN ('inspection_defect', 'workshop_vehicle_task')
    AND effective_has_module_permission('workshop-tasks')
  )
  WITH CHECK (
    action_type IN ('inspection_defect', 'workshop_vehicle_task')
    AND effective_has_module_permission('workshop-tasks')
  );

CREATE POLICY "Workshop users can create workshop tasks" ON actions
  FOR INSERT TO authenticated
  WITH CHECK (
    action_type IN ('inspection_defect', 'workshop_vehicle_task')
    AND effective_has_module_permission('workshop-tasks')
  );

COMMIT;
