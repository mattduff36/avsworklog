-- Align remaining module-gated RLS policies to the team permission matrix.
-- Uses effective_has_module_permission(...) so page/module access matches data access.

BEGIN;

-- -----------------------------------------------------------------------------
-- dvla_sync_log (maintenance module)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users with maintenance permission view sync log" ON dvla_sync_log;
CREATE POLICY "Users with maintenance permission view sync log"
  ON dvla_sync_log
  FOR SELECT
  TO authenticated
  USING (
    effective_has_module_permission('maintenance')
  );

-- -----------------------------------------------------------------------------
-- workshop_task_comments (workshop-tasks module)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Workshop users can create own comments" ON workshop_task_comments;
CREATE POLICY "Workshop users can create own comments"
  ON workshop_task_comments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM actions a
      WHERE a.id = workshop_task_comments.task_id
        AND a.action_type IN ('inspection_defect', 'workshop_vehicle_task')
        AND effective_has_module_permission('workshop-tasks')
    )
  );

DROP POLICY IF EXISTS "Workshop users can read comments for workshop tasks" ON workshop_task_comments;
CREATE POLICY "Workshop users can read comments for workshop tasks"
  ON workshop_task_comments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM actions a
      WHERE a.id = workshop_task_comments.task_id
        AND a.action_type IN ('inspection_defect', 'workshop_vehicle_task')
        AND effective_has_module_permission('workshop-tasks')
    )
  );

-- -----------------------------------------------------------------------------
-- workshop_task_attachments (workshop-tasks module)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Workshop users can read task attachments" ON workshop_task_attachments;
CREATE POLICY "Workshop users can read task attachments"
  ON workshop_task_attachments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM actions a
      WHERE a.id = workshop_task_attachments.task_id
        AND a.action_type IN ('inspection_defect', 'workshop_vehicle_task')
        AND effective_has_module_permission('workshop-tasks')
    )
  );

-- -----------------------------------------------------------------------------
-- workshop_attachment_schema_snapshots (workshop-tasks module)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Workshop users can create schema snapshots" ON workshop_attachment_schema_snapshots;
CREATE POLICY "Workshop users can create schema snapshots"
  ON workshop_attachment_schema_snapshots
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM workshop_task_attachments wta
      JOIN actions a ON a.id = wta.task_id
      WHERE wta.id = workshop_attachment_schema_snapshots.attachment_id
        AND a.action_type IN ('inspection_defect', 'workshop_vehicle_task')
        AND effective_has_module_permission('workshop-tasks')
    )
  );

DROP POLICY IF EXISTS "Workshop users can read schema snapshots" ON workshop_attachment_schema_snapshots;
CREATE POLICY "Workshop users can read schema snapshots"
  ON workshop_attachment_schema_snapshots
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM workshop_task_attachments wta
      JOIN actions a ON a.id = wta.task_id
      WHERE wta.id = workshop_attachment_schema_snapshots.attachment_id
        AND a.action_type IN ('inspection_defect', 'workshop_vehicle_task')
        AND effective_has_module_permission('workshop-tasks')
    )
  );

-- -----------------------------------------------------------------------------
-- workshop_attachment_field_responses (workshop-tasks module)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Workshop users can create field responses v2" ON workshop_attachment_field_responses;
CREATE POLICY "Workshop users can create field responses v2"
  ON workshop_attachment_field_responses
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM workshop_task_attachments wta
      JOIN actions a ON a.id = wta.task_id
      WHERE wta.id = workshop_attachment_field_responses.attachment_id
        AND a.action_type IN ('inspection_defect', 'workshop_vehicle_task')
        AND effective_has_module_permission('workshop-tasks')
    )
  );

DROP POLICY IF EXISTS "Workshop users can read field responses v2" ON workshop_attachment_field_responses;
CREATE POLICY "Workshop users can read field responses v2"
  ON workshop_attachment_field_responses
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM workshop_task_attachments wta
      JOIN actions a ON a.id = wta.task_id
      WHERE wta.id = workshop_attachment_field_responses.attachment_id
        AND a.action_type IN ('inspection_defect', 'workshop_vehicle_task')
        AND effective_has_module_permission('workshop-tasks')
    )
  );

DROP POLICY IF EXISTS "Workshop users can update field responses v2" ON workshop_attachment_field_responses;
CREATE POLICY "Workshop users can update field responses v2"
  ON workshop_attachment_field_responses
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM workshop_task_attachments wta
      JOIN actions a ON a.id = wta.task_id
      WHERE wta.id = workshop_attachment_field_responses.attachment_id
        AND a.action_type IN ('inspection_defect', 'workshop_vehicle_task')
        AND effective_has_module_permission('workshop-tasks')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM workshop_task_attachments wta
      JOIN actions a ON a.id = wta.task_id
      WHERE wta.id = workshop_attachment_field_responses.attachment_id
        AND a.action_type IN ('inspection_defect', 'workshop_vehicle_task')
        AND effective_has_module_permission('workshop-tasks')
    )
  );

COMMIT;
