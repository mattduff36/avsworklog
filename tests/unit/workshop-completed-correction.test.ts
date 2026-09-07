import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import {
  CorrectAttachmentResponsesBodySchema,
  CorrectCompletedTaskBodySchema,
  canonicalizeAttachmentResponses,
  diffAttachmentResponses,
  hashAttachmentResponses,
  timestampsMatch,
} from '@/lib/workshop-tasks/completed-correction';
import { isServiceWorkshopTask } from '@/lib/workshop-tasks/is-service-task';

function readRepo(relativePath: string): string {
  const absolute = resolve(process.cwd(), relativePath);
  expect(existsSync(absolute)).toBe(true);
  return readFileSync(absolute, 'utf8');
}

describe('completed workshop corrections', () => {
  it('WT-CORR-CTA-001 uses explicit workshop CTA colours', () => {
    const dialog = readRepo('components/workshop-tasks/CorrectServiceTaskDialog.tsx');
    expect(dialog).toContain('data-accent="workshop"');
    expect(dialog).toContain('bg-workshop hover:bg-workshop-dark text-white');
    expect(dialog).toContain('DialogContent className="sm:max-w-md text-white"');
  });

  it('WT-CORR-TASK-003 builds a corrected history event kind', () => {
    const source = readRepo('lib/server/workshop-completed-task-correction.ts');
    expect(source).toContain("status: 'corrected'");
    expect(source).toContain("event_kind: 'completed_task_correction'");
    expect(source).toContain('boundedTaskCorrectionValues');
  });

  it('rejects empty completed-task payloads and unknown fields', () => {
    expect(
      CorrectCompletedTaskBodySchema.safeParse({
        reason: 'Fix the recorded comments',
        expectedUpdatedAt: '2026-09-07T10:00:00.000Z',
      }).success
    ).toBe(false);
    expect(
      CorrectCompletedTaskBodySchema.safeParse({
        reason: 'Fix the recorded comments',
        expectedUpdatedAt: '2026-09-07T10:00:00.000Z',
        workshop_comments: 'Updated workshop notes',
        extra: true,
      }).success
    ).toBe(false);
    expect(
      CorrectCompletedTaskBodySchema.safeParse({
        reason: 'Fix the recorded comments',
        expectedUpdatedAt: '2026-09-07T10:00:00.000Z',
        workshop_comments: 'Updated workshop notes',
      }).success
    ).toBe(true);
  });

  it('hashes and diffs attachment responses canonically', () => {
    const previous = canonicalizeAttachmentResponses([
      { section_key: 'details', field_key: 'odometer_reading', response_value: '1' },
    ]);
    const next = canonicalizeAttachmentResponses([
      { section_key: 'details', field_key: 'odometer_reading', response_value: '650153' },
    ]);
    expect(hashAttachmentResponses(previous)).not.toBe(hashAttachmentResponses(next));
    const diff = diffAttachmentResponses(previous, next);
    expect(diff.changedFields).toEqual(['details::odometer_reading']);
  });

  it('matches timestamps by millisecond identity', () => {
    expect(timestampsMatch('2026-09-07T10:00:00.000Z', '2026-09-07T10:00:00.000Z')).toBe(true);
    expect(timestampsMatch('2026-09-07T10:00:00.000Z', '2026-09-07T10:00:01.000Z')).toBe(false);
  });

  it('identifies Service workshop tasks', () => {
    expect(isServiceWorkshopTask({ workshop_task_categories: { name: 'Service (HGV)' } })).toBe(true);
    expect(isServiceWorkshopTask({ workshop_task_categories: { name: 'Brakes' } })).toBe(false);
    expect(
      isServiceWorkshopTask({
        workshop_task_categories: { name: 'Brakes' },
        workshop_task_subcategories: {
          workshop_task_categories: { name: 'Service (HGV)' },
        },
      })
    ).toBe(true);
  });

  it('WT-CORR-AUTH routes use manager app-session access and no getUser boundary', () => {
    for (const file of [
      'app/api/workshop-tasks/tasks/[taskId]/correct-completed/route.ts',
      'app/api/workshop-tasks/attachments/[id]/correct-responses/route.ts',
      'app/api/workshop-tasks/tasks/[taskId]/correct-service/route.ts',
    ]) {
      const source = readRepo(file);
      expect(source).toContain('requireWorkshopTasksManagerAccess');
      expect(source).toContain('jsonWithWorkshopSession');
      expect(source).not.toContain('supabase.auth.getUser');
    }
    const timestamp = readRepo('app/api/workshop-tasks/tasks/[taskId]/timeline/[timelineItemId]/timestamp/route.ts');
    expect(timestamp).toContain('requireWorkshopTasksAccess');
    expect(timestamp).toContain('jsonWithWorkshopSession');
    expect(timestamp).not.toContain('supabase.auth.getUser');
    expect(timestamp).not.toContain('userHasPermission');
  });

  it('WT-CORR-DIRECT-001 migration blocks authenticated completed mutations', () => {
    const migration = readRepo('supabase/migrations/20260907_workshop_completed_task_corrections.sql');
    expect(migration).toContain('prevent_unauthorised_completed_workshop_task_mutation');
    expect(migration).toContain('prevent_completed_workshop_attachment_mutation');
    expect(migration).toContain('jsonb_preserves_correction_events');
    expect(migration).toContain('Completed-task correction history cannot be altered');
    expect(migration).toContain('workshop_task_subcategories');
    expect(migration).toContain('is_unified_service_workshop_category(OLD.workshop_category_id)');
    expect(migration).toContain('workshop_attachment_corrections');
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('GRANT SELECT, INSERT');
    expect(migration).not.toContain('GRANT UPDATE');
    expect(migration).not.toContain('GRANT DELETE');
    expect(migration).toContain("IS DISTINCT FROM 'completed'");
  });

  it('WT-CORR-ATT-003 blocks completed attachment add/delete and schema writes', () => {
    const add = readRepo('app/api/workshop-tasks/attachments/task/[taskId]/route.ts');
    const remove = readRepo('app/api/workshop-tasks/attachments/[id]/route.ts');
    const schema = readRepo('app/api/workshop-tasks/attachments/[id]/schema/route.ts');
    expect(add).toContain('Attachments cannot be added to a completed task');
    expect(remove).toContain('Attachments cannot be removed from a completed task');
    expect(schema).toContain("typedAttachment.status === 'completed' || parentTask?.status === 'completed'");
    expect(schema).toContain('status: 409');
  });

  it('WT-CORR-SVC-001 keeps Service meter correction on the product function', () => {
    const server = readRepo('lib/server/asset-service.ts');
    expect(server).toContain('export async function correctServiceWorkshopTask');
    expect(server).toContain('isUnifiedServiceMembership');
    expect(server).toContain("event_type, notes, corrects_event_id");
    expect(server).toContain("'correction'");
    expect(server).toContain('calculateNextDueMeter(input.completionMeter, config.intervalValue)');
    expect(readRepo('app/(dashboard)/workshop-tasks/hooks/useWorkshopTaskCrudActions.ts')).toContain(
      '/correct-completed'
    );
    expect(readRepo('app/(dashboard)/workshop-tasks/hooks/useWorkshopTaskCrudActions.ts')).not.toContain(
      'completionMeter'
    );
  });

  it('WT-CORR-SVC-002 correction context returns latest effective meter and upserts HGV values', () => {
    const source = readRepo('lib/server/asset-service.ts');
    expect(source).toContain('currentCompletionMeter');
    expect(source).toContain('upsertHgvServiceCategoryValues');
    expect(source).toContain('ORDER BY created_at DESC');
    expect(source).toContain('if ((updated.rowCount ?? 0) > 0) return');
    expect(source).toContain('INSERT INTO public.asset_maintenance_category_values');
  });

  it('WT-CORR-PROD-001 uses a dry-run-first SS15AVS product-function script', () => {
    const script = readRepo('scripts/correct-ss15avs-completion-km.ts');
    expect(script).toContain('SS15AVS');
    expect(script).toContain('650153');
    expect(script).toContain('correctServiceWorkshopTask');
    expect(script).toContain('correctCompletedAttachmentResponses');
    expect(script).toContain("const ODOMETER_FIELD_KEY = 'odometer_reading'");
    expect(script).toContain('AND fr.field_key = $2');
    expect(script).toContain('--dry-run');
    expect(script).toContain('--confirm-apply');
    expect(script).toContain('ss15avs-650153');
    expect(script).toContain('event_type = \'completion\'');
    expect(script).toContain('mc.workshop_category_id IN (a.workshop_category_id, s.category_id)');
    expect(script).not.toContain('console.log(connectionString');
  });

  it('keeps UI correction behind View-As aware manager flags', () => {
    const page = readRepo('app/(dashboard)/workshop-tasks/page.tsx');
    expect(page).toContain('const { user, profile, isManager, isAdmin } = useAuth()');
    expect(page).toContain('canCorrectCompleted={showSettings}');
    expect(readRepo('lib/providers/auth-provider.tsx')).toContain(
      'const roleForFlags = isViewingAs ? effectiveRole : profile?.role ?? null'
    );
  });

  it('rejects attachment corrections without a long enough reason', () => {
    expect(
      CorrectAttachmentResponsesBodySchema.safeParse({
        reason: 'too short',
        expectedPreimageHash: 'abc12345',
        responses: [{ section_key: 'details', field_key: 'odometer_reading', response_value: '1' }],
      }).success
    ).toBe(false);
  });
});
