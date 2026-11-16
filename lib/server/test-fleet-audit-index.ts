// Shared by the reset service and the reviewed concurrent-index migration runner.
// Identifiers and paths are constants, never caller input.
export const TEST_FLEET_AUDIT_INDEX_NAME = 'idx_audit_log_test_fleet_references';
export const TEST_FLEET_AUDIT_TABLES = [
  'vehicles','vehicle_inspections','vans','hgvs','plant',
  'van_inspections','hgv_inspections','plant_inspections','inspection_items','inspection_photos',
  'inspection_daily_hours','hgv_inspection_versions','hgv_defect_observations',
  'actions','workshop_task_comments','workshop_task_attachments','workshop_attachment_field_responses',
  'workshop_attachment_responses','workshop_attachment_corrections','workshop_task_check_photos',
  'asset_service_events','vehicle_maintenance','maintenance_history','dvla_sync_log','mot_test_history',
  'reminder_actions','reminders','van_archive','plant_service_intervals',
  'daily_plant_allocation_drafts','daily_allocation_visit_plant','daily_allocation_conflict_overrides',
] as const;
export const TEST_FLEET_AUDIT_KEYS = ['van_id','vehicle_id','hgv_id','plant_id','inspection_id','task_id','attachment_id','inspection_item_id','action_id'] as const;
export const TEST_FLEET_AUDIT_REFERENCES_SQL = `ARRAY[${[
  ...TEST_FLEET_AUDIT_KEYS.flatMap(key=>[`changes->>'${key}'`,`changes#>>'{${key},old}'`,`changes#>>'{${key},new}'`]),
  ...['van_id','vehicle_id','hgv_id','plant_id'].map(key=>`changes#>>'{inspection,${key}}'`),
].join(',')}]`;
export const TEST_FLEET_AUDIT_PREDICATE_SQL = `action <> 'test_fleet_reset' AND table_name IN (${TEST_FLEET_AUDIT_TABLES.map(name=>`'${name}'`).join(',')})`;
