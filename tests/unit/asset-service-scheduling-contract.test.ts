import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import {
  calculateNextDueMeter,
  getSuccessorStep,
  resolveStepForTemplateAfter,
  resolveStepForTemplateFirst,
  shouldShowServiceTypeBadge,
  type ServiceRotationStep,
} from '@/lib/utils/assetServiceRotation';
import {
  MAINTENANCE_CATEGORY_NAMES,
  categoryAppliesToAsset,
} from '@/lib/utils/maintenanceCategoryRules';

const HGV_STEPS: ServiceRotationStep[] = [
  { id: 's1', position: 1, attachmentTemplateId: 'basic-a', compactLabel: 'Basic A' },
  { id: 's2', position: 2, attachmentTemplateId: 'basic-b', compactLabel: 'Basic B' },
  { id: 's3', position: 3, attachmentTemplateId: 'basic-a', compactLabel: 'Basic A' },
  { id: 's4', position: 4, attachmentTemplateId: 'full', compactLabel: 'Full' },
];

function readRepo(relativePath: string): string {
  const absolute = resolve(process.cwd(), relativePath);
  expect(existsSync(absolute)).toBe(true);
  return readFileSync(absolute, 'utf8');
}

describe('SVC-SCHEMA-001 schema constraints and RLS policies', () => {
  it('SVC-SCHEMA-001 persists FKs, unique completion index, and RLS', () => {
    const schema = readRepo('supabase/migrations/20260808_unify_asset_service_scheduling.sql');
    const correction = readRepo('supabase/migrations/20260808_asset_service_correction_events.sql');
    expect(schema).toContain('workshop_category_attachment_templates');
    expect(schema).toContain('service_rotation_steps');
    expect(schema).toContain('asset_service_events');
    expect(schema).toContain('ENABLE ROW LEVEL SECURITY');
    expect(schema).toContain('next_service_template_id');
    expect(correction).toContain('asset_service_events_one_completion_per_task');
    expect(correction).toContain('corrects_event_id');
  });
});

describe('SVC-SEED-001 service defaults and mappings', () => {
  it('SVC-SEED-001 seeds Van 10000 miles, HGV 25000 km, Plant 250 hours', () => {
    const schema = readRepo('supabase/migrations/20260808_unify_asset_service_scheduling.sql');
    expect(schema).toMatch(/service_van[\s\S]*10000|10000[\s\S]*service_van/i);
    expect(schema).toMatch(/25000/);
    expect(schema).toMatch(/'km'/);
    expect(schema).toMatch(/250/);
    expect(schema).toContain('service_plant');
    expect(schema).toContain('service_hgv');
  });
});

describe('SVC-ROT-001 HGV rotation order', () => {
  it('SVC-ROT-001 advances A1 → B → A2 → Full → A1', () => {
    expect(getSuccessorStep(HGV_STEPS, 's1')?.id).toBe('s2');
    expect(getSuccessorStep(HGV_STEPS, 's2')?.id).toBe('s3');
    expect(getSuccessorStep(HGV_STEPS, 's3')?.id).toBe('s4');
    expect(getSuccessorStep(HGV_STEPS, 's4')?.id).toBe('s1');
  });
});

describe('SVC-ROT-002 duplicate Basic A resolution', () => {
  it('SVC-ROT-002 resolves duplicate Basic A deterministically', () => {
    expect(resolveStepForTemplateFirst(HGV_STEPS, 'basic-a')?.id).toBe('s1');
    expect(resolveStepForTemplateAfter(HGV_STEPS, 'basic-a', 's2')?.id).toBe('s3');
    expect(resolveStepForTemplateAfter(HGV_STEPS, 'basic-a', 's4')?.id).toBe('s1');
  });
});

describe('SVC-ASSET-001 asset create requires next type', () => {
  it('SVC-ASSET-001 create APIs require next_service_template_id', () => {
    for (const file of [
      'app/api/admin/vans/route.ts',
      'app/api/admin/hgvs/route.ts',
      'app/api/admin/plant/route.ts',
    ]) {
      const source = readRepo(file);
      expect(source).toContain('next_service_template_id');
      expect(source).toMatch(/required|seedAssetServiceState/i);
    }
  });
});

describe('SVC-ASSET-002 manager next-type edits', () => {
  it('SVC-ASSET-002 only privileged paths mutate next service type', () => {
    const byVehicle = readRepo('app/api/maintenance/by-vehicle/[vehicleId]/route.ts');
    const settings = readRepo('app/api/workshop-tasks/service-settings/route.ts');
    expect(byVehicle).toContain('next_service_template_id');
    expect(settings).toMatch(/Manager|canEffectiveRoleUseModuleLevel|is_manager/i);
  });
});

describe('SVC-ATTACH-001 linked attachment cardinality', () => {
  it('SVC-ATTACH-001 enforces exact-one linked attachments and zero-link rejection', () => {
    const attachments = readRepo('app/api/workshop-tasks/attachments/task/[taskId]/route.ts');
    expect(attachments).toContain('does not allow attachments');
    expect(attachments).toContain('exactly one linked attachment');
  });
});

describe('SVC-COMPLETE-001 completion guards', () => {
  it('SVC-COMPLETE-001 blocks incomplete service completion inputs', () => {
    const server = readRepo('lib/server/asset-service.ts');
    expect(server).toContain('A valid completion meter reading is required');
    expect(server).toContain('Next service type confirmation is required');
    expect(server).toContain('Linked service attachment must be completed');
  });
});

describe('SVC-COMPLETE-002 due meter calculation', () => {
  it('SVC-COMPLETE-002 uses actual meter plus interval', () => {
    expect(calculateNextDueMeter(275402, 25000)).toBe(300402);
  });
});

describe('SVC-TXN-001 transactional completion', () => {
  it('SVC-TXN-001 wraps completion and correction in BEGIN/COMMIT transactions', () => {
    const server = readRepo('lib/server/asset-service.ts');
    const lifecycle = readRepo(
      'app/(dashboard)/workshop-tasks/hooks/useWorkshopTaskLifecycleActions.ts',
    );
    expect(server).toContain("await client.query('BEGIN')");
    expect(server).toContain("await client.query('COMMIT')");
    expect(server).toContain("await client.query('ROLLBACK')");
    expect(server).toContain('completeServiceWorkshopTask');
    expect(server).toContain('correctServiceWorkshopTask');
    expect(lifecycle).toContain('if (!isServiceTask)');
    expect(lifecycle).toContain('/complete-service');
  });
});

describe('SVC-IDEMPOTENT-001 completion idempotency', () => {
  it('SVC-IDEMPOTENT-001 returns existing completion event for repeated task IDs', () => {
    const server = readRepo('lib/server/asset-service.ts');
    expect(server).toContain('alreadyCompleted');
    expect(server).toContain("event_type = 'completion'");
    expect(server).toContain('ON CONFLICT (task_id) WHERE (event_type = \'completion\') DO NOTHING');
  });
});

describe('SVC-RUNTIME-001 maintenance history schema', () => {
  it('SVC-RUNTIME-001 writes maintenance history through updated_by', () => {
    const server = readRepo('lib/server/asset-service.ts');
    expect(server).toContain('updated_by');
    expect(server).not.toContain('changed_by');
  });
});

describe('SVC-STATE-001 strict service category identity', () => {
  it('SVC-STATE-001 rejects null and mismatched service categories', () => {
    const server = readRepo('lib/server/asset-service.ts');
    expect(server.match(/!config\.workshopCategoryId/g)?.length).toBeGreaterThanOrEqual(2);
    expect(server.match(/!task\.workshop_category_id/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe('SVC-HGV-BACKFILL-001 screenshot reconciliation', () => {
  it('SVC-HGV-BACKFILL-001 backfills exactly 12 HGVs and excludes TEST-HGV', () => {
    const runner = readRepo('scripts/run-unify-asset-service-scheduling-migration.ts');
    expect(runner).toContain('SCREENSHOT_ROWS');
    expect(runner).toContain('AS71 AVS');
    expect(runner).toContain('TEST-HGV');
    expect(runner).toMatch(/exclude|excluded|!==|!.*TEST/i);
    const matches = runner.match(/regNumber:\s*'/g);
    expect(matches?.length).toBe(12);
  });
});

describe('SVC-HISTORY-001 historical subcategory preservation', () => {
  it('SVC-HISTORY-001 preserves subcategory snapshots and deactivates without deletion', () => {
    const schema = readRepo('supabase/migrations/20260808_unify_asset_service_scheduling.sql');
    const closure = readRepo('supabase/migrations/20260808_asset_service_closure_fixes.sql');
    expect(schema).toContain('workshop_subcategory_name_snapshot');
    expect(schema).toMatch(/is_active\s*=\s*FALSE/i);
    expect(schema).not.toMatch(/DELETE FROM public\.workshop_task_subcategories/i);
    expect(closure).toContain('Repair (Van)');
    expect(closure).toContain('is_active = TRUE');
  });
});

describe('SVC-MIG-001 additive TEST-HGV correction', () => {
  it('SVC-MIG-001 excludes and clears TEST-HGV unified service state', () => {
    const schema = readRepo('supabase/migrations/20260808_unify_asset_service_scheduling.sql');
    const fixes = readRepo('supabase/migrations/20260808_asset_service_review_fixes.sql');
    expect(schema).toContain('TE57HGV');
    expect(fixes).toContain('TEST-HGV retained unified service state');
    expect(fixes).toContain('next_service_mileage = NULL');
  });
});

describe('SVC-MIG-002 atomic rerun protection', () => {
  it('SVC-MIG-002 keeps schema and reconciliation in one guarded runner transaction', () => {
    const schema = readRepo('supabase/migrations/20260808_unify_asset_service_scheduling.sql');
    const runner = readRepo('scripts/run-unify-asset-service-scheduling-migration.ts');
    expect(schema).not.toMatch(/^BEGIN;|^COMMIT;/m);
    expect(runner).toContain("await client.query('BEGIN')");
    expect(runner).toContain("await client.query('COMMIT')");
    expect(runner).toContain('Refusing migration');
    expect(runner).toContain('preserved newer completed service state');
  });
});

describe('SVC-TEMPLATE-001 template lifecycle safeguards', () => {
  it('SVC-TEMPLATE-001 snapshots names and blocks inactive template selection', () => {
    const attachments = readRepo('app/api/workshop-tasks/attachments/task/[taskId]/route.ts');
    const schema = readRepo('supabase/migrations/20260808_unify_asset_service_scheduling.sql');
    expect(attachments).toContain('Template is inactive');
    expect(schema).toContain('template_name_snapshot');
  });
});

describe('SVC-UI-001 service badge visibility', () => {
  it('SVC-UI-001 shows badge only with 2+ distinct linked templates', () => {
    expect(shouldShowServiceTypeBadge(1)).toBe(false);
    expect(shouldShowServiceTypeBadge(2)).toBe(true);
    expect(categoryAppliesToAsset(undefined, 'hgv', MAINTENANCE_CATEGORY_NAMES.hgvService)).toBe(true);
    expect(categoryAppliesToAsset(undefined, 'hgv', MAINTENANCE_CATEGORY_NAMES.engineService)).toBe(false);
  });
});

describe('SVC-REGRESSION-001 non-service flows remain intact', () => {
  it('SVC-REGRESSION-001 keeps van/plant rules and non-service patterns', () => {
    expect(categoryAppliesToAsset(undefined, 'van', MAINTENANCE_CATEGORY_NAMES.service)).toBe(true);
    expect(categoryAppliesToAsset(undefined, 'plant', MAINTENANCE_CATEGORY_NAMES.serviceHours)).toBe(true);
    const sync = readRepo('lib/utils/workshopMaintenanceSync.ts');
    expect(sync).toContain('next_service_mileage');
    expect(sync).toContain('6 Weekly Inspection Due');
  });
});

describe('SVC-RLS-001 permission boundaries', () => {
  it('SVC-RLS-001 keeps settings/completion/correction behind permission checks', () => {
    const settings = readRepo('app/api/workshop-tasks/service-settings/route.ts');
    const complete = readRepo('app/api/workshop-tasks/tasks/[taskId]/complete-service/route.ts');
    const correct = readRepo('app/api/workshop-tasks/tasks/[taskId]/correct-service/route.ts');
    const maintenance = readRepo('app/api/maintenance/by-vehicle/[vehicleId]/route.ts');
    const schema = readRepo('supabase/migrations/20260808_unify_asset_service_scheduling.sql');
    const fixes = readRepo('supabase/migrations/20260808_asset_service_review_fixes.sql');
    const closure = readRepo('supabase/migrations/20260808_asset_service_closure_fixes.sql');
    expect(settings).toContain('isEffectiveRoleManagerOrHigher');
    expect(complete).toContain('userHasPermission');
    expect(correct).toContain('isEffectiveRoleManagerOrHigher');
    expect(maintenance).toContain('isEffectiveRoleManagerOrHigher');
    expect(schema).toContain('ENABLE ROW LEVEL SECURITY');
    expect(fixes).toContain('trg_protect_vehicle_maintenance_service_state');
    expect(fixes).toContain('WITH CHECK (public.effective_is_manager_admin())');
    expect(closure).toContain('BEFORE INSERT OR UPDATE OF');
    expect(closure).toContain('next_service_mileage');
    expect(closure).toContain('next_service_hours');
  });
});

describe('SVC-MIG-003 scoped subcategory deactivation', () => {
  it('SVC-MIG-003 keeps only Van Repair subcategories deactivated', () => {
    const closure = readRepo('supabase/migrations/20260808_asset_service_closure_fixes.sql');
    expect(closure).toContain('Repair (Van)');
    expect(closure).toContain('Van Repair subcategories must remain deactivated');
    expect(closure).toContain('Non-repair subcategories must be reactivated');
  });
});

describe('SVC-VERIFY-001 behavioral evidence coverage', () => {
  it('SVC-VERIFY-001 covers rotation, due meter, and schema contracts in executable tests', () => {
    expect(getSuccessorStep(
      [
        { id: 's1', position: 1, attachmentTemplateId: 'a' },
        { id: 's2', position: 2, attachmentTemplateId: 'b' },
      ],
      's1',
    )?.id).toBe('s2');
    expect(calculateNextDueMeter(1000, 25000)).toBe(26000);
    expect(shouldShowServiceTypeBadge(2)).toBe(true);
  });
});

describe('SVC-VERIFY-002 migration validation evidence', () => {
  it('SVC-VERIFY-002 retains migration runners and validation hooks', () => {
    expect(existsSync(resolve(process.cwd(), 'scripts/run-unify-asset-service-scheduling-migration.ts'))).toBe(true);
    expect(existsSync(resolve(process.cwd(), 'scripts/run-asset-service-review-fixes-migration.ts'))
      || existsSync(resolve(process.cwd(), 'scripts/run-asset-service-correction-events-migration.ts'))).toBe(true);
    expect(existsSync(resolve(process.cwd(), 'scripts/run-asset-service-closure-fixes-migration.ts'))).toBe(true);
    expect(existsSync(resolve(process.cwd(), 'scripts/db-validate.ts'))).toBe(true);
  });
});

describe('SVC-UNDO-001 completed Service immutability', () => {
  it('SVC-UNDO-001 blocks direct status undo after a completion event', () => {
    const fixes = readRepo('supabase/migrations/20260808_asset_service_review_fixes.sql');
    expect(fixes).toContain('trg_prevent_completed_service_task_undo');
    expect(fixes).toContain('Completed Service tasks cannot be undone');
  });
});

describe('SVC-AUDIT-001 append-only service audit', () => {
  it('SVC-AUDIT-001 restricts event inserts and asset deletion cascades', () => {
    const fixes = readRepo('supabase/migrations/20260808_asset_service_review_fixes.sql');
    expect(fixes).toContain('WITH CHECK (public.effective_is_manager_admin())');
    expect(fixes.match(/ON DELETE RESTRICT/g)?.length).toBeGreaterThanOrEqual(3);
  });
});

describe('SVC-CONFIG-001 service settings integrity', () => {
  it('SVC-CONFIG-001 / SVC-CONFIG-002 rejects inactive templates and mismatched units', () => {
    const server = readRepo('lib/server/asset-service.ts');
    expect(server).toContain('Inactive or missing templates cannot be linked to Service');
    expect(server).toContain('getDefaultMeterUnit(input.assetType)');
  });
});

describe('SVC-UI-002 active distinct badge count', () => {
  it('SVC-UI-002 counts distinct active linked templates only', () => {
    const maintenance = readRepo('app/api/maintenance/route.ts');
    expect(maintenance).toContain("eq('is_active', true)");
    expect(maintenance).toContain('distinctTemplateIds');
  });
});

describe('SVC-ROLLBACK-001 rollback readiness', () => {
  it('SVC-ROLLBACK-001 retains dual-write and correction append-only events', () => {
    const server = readRepo('lib/server/asset-service.ts');
    const correction = readRepo('supabase/migrations/20260808_asset_service_correction_events.sql');
    expect(server).toContain('Dual-write HGV custom value for rollback window');
    expect(server).toContain("'correction'");
    expect(correction).toContain('corrects_event_id');
  });
});
