import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockQuery, loadServiceConfig, validateRequiredSchemaResponses } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  loadServiceConfig: vi.fn(),
  validateRequiredSchemaResponses: vi.fn(),
}));

vi.mock('pg', () => ({
  default: {
    Client: vi.fn(() => ({
      connect: vi.fn(),
      end: vi.fn(),
      query: mockQuery,
    })),
  },
}));

vi.mock('@/lib/server/asset-service', () => ({
  AssetServiceError: class AssetServiceError extends Error {
    status = 400;
  },
  loadServiceConfig,
}));

vi.mock('@/lib/workshop-attachments/schema-validation', () => ({
  validateRequiredSchemaResponses,
}));

import { correctCompletedWorkshopTask } from '@/lib/server/workshop-completed-task-correction';
import { correctCompletedAttachmentResponses } from '@/lib/server/workshop-attachment-correction';
import { getLatestCompletedEvent } from '@/lib/utils/workshopTaskTimeline';
import { hashAttachmentResponses, canonicalizeAttachmentResponses } from '@/lib/workshop-tasks/completed-correction';

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const ATTACHMENT_ID = '22222222-2222-4222-8222-222222222222';
const HGV_ID = '33333333-3333-4333-8333-333333333333';
const SERVICE_CATEGORY_ID = '44444444-4444-4444-8444-444444444444';
const BRAKES_CATEGORY_ID = '55555555-5555-4555-8555-555555555555';
const UPDATED_AT = '2026-09-07T10:00:00.000Z';

function serviceConfig(workshopCategoryId: string | null = SERVICE_CATEGORY_ID) {
  return {
    maintenanceCategoryId: 'mc-service',
    configKey: 'service_hgv' as const,
    intervalValue: 25000,
    intervalUnit: 'km' as const,
    workshopCategoryId,
    steps: [],
  };
}

function completedTask(overrides: Record<string, unknown> = {}) {
  return {
    id: TASK_ID,
    status: 'completed',
    action_type: 'workshop_vehicle_task',
    title: 'Workshop Task - SS15 AVS',
    description: 'Original workshop notes',
    workshop_comments: 'Original workshop notes',
    van_id: null,
    hgv_id: HGV_ID,
    plant_id: null,
    workshop_category_id: BRAKES_CATEGORY_ID,
    workshop_subcategory_id: null,
    asset_meter_reading: 100,
    asset_meter_unit: 'km',
    status_history: [
      {
        id: 'evt-complete',
        type: 'status',
        status: 'completed',
        created_at: '2026-09-01T09:00:00.000Z',
        author_id: 'actor',
      },
    ],
    updated_at: UPDATED_AT,
    ...overrides,
  };
}

function sqlOf(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('completed workshop correction runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.POSTGRES_URL = 'postgres://user:pass@localhost:5432/testdb';
    loadServiceConfig.mockResolvedValue(serviceConfig());
    validateRequiredSchemaResponses.mockReturnValue([]);
  });

  it('WT-CORR-TASK-001 corrects comments and meter on a completed non-Service task', async () => {
    const task = completedTask({ asset_meter_unit: 'miles' });
    mockQuery.mockImplementation(async (sql: string) => {
      const normalized = sqlOf(sql);
      if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') {
        return { rows: [] };
      }
      if (normalized.includes('FROM public.actions') && normalized.includes('FOR UPDATE')) {
        return { rows: [task] };
      }
      if (normalized.includes('FROM public.hgvs')) {
        return { rows: [{ reg_number: 'SS15 AVS', nickname: null }] };
      }
      if (normalized.includes('FROM public.profiles')) {
        return { rows: [{ full_name: 'Workshop Manager' }] };
      }
      if (normalized.startsWith('UPDATE public.actions')) {
        expect(normalized).toContain('workshop_comments = $2');
        expect(normalized).not.toContain("status = '");
        return { rows: [{ updated_at: '2026-09-07T11:00:00.000Z' }] };
      }
      if (normalized.startsWith('INSERT INTO public.maintenance_history')) {
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${normalized}`);
    });

    const result = await correctCompletedWorkshopTask({
      taskId: TASK_ID,
      actorId: 'actor',
      body: {
        reason: 'Fix recorded comments and meter',
        expectedUpdatedAt: UPDATED_AT,
        workshop_comments: 'Corrected workshop notes',
        meter_reading: 120,
      },
    });

    expect(result.updatedAt).toBe('2026-09-07T11:00:00.000Z');
    const updateCall = mockQuery.mock.calls.find((call) => sqlOf(String(call[0])).startsWith('UPDATE public.actions'));
    expect(updateCall?.[1]?.[1]).toBe('Corrected workshop notes');
    expect(updateCall?.[1]?.[4]).toBe(120);
    const history = JSON.parse(String(updateCall?.[1]?.[11])) as Array<{
      status: string;
      meta?: { event_kind?: string; before?: Record<string, unknown>; after?: Record<string, unknown> };
    }>;
    expect(history.at(-1)?.status).toBe('corrected');
    expect(history.at(-1)?.meta?.event_kind).toBe('completed_task_correction');
    expect(history.at(-1)?.meta?.after?.workshop_comments).toBe('Corrected workshop notes');
    expect(history.at(-1)?.meta?.after).toHaveProperty('description');
    expect(history.at(-1)?.meta?.after).toHaveProperty('asset_meter_unit');
    expect(history.some((event) => event.status === 'completed')).toBe(true);
    expect(history.filter((event) => event.status === 'completed')).toHaveLength(1);
    expect(mockQuery.mock.calls.some((call) => sqlOf(String(call[0])).startsWith('INSERT INTO public.maintenance_history'))).toBe(true);
  });

  it('WT-CORR-TASK-002 rejects Service identity/meter changes and inspection defects', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      const normalized = sqlOf(sql);
      if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') {
        return { rows: [] };
      }
      if (normalized.includes('FROM public.actions')) {
        return { rows: [completedTask({ workshop_category_id: SERVICE_CATEGORY_ID })] };
      }
      throw new Error(`Unexpected query: ${normalized}`);
    });

    await expect(
      correctCompletedWorkshopTask({
        taskId: TASK_ID,
        actorId: 'actor',
        body: {
          reason: 'Try to change Service meter',
          expectedUpdatedAt: UPDATED_AT,
          meter_reading: 650153,
        },
      })
    ).rejects.toMatchObject({
      name: 'WorkshopCorrectionError',
      status: 400,
    });

    mockQuery.mockImplementation(async (sql: string) => {
      const normalized = sqlOf(sql);
      if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') {
        return { rows: [] };
      }
      if (normalized.includes('FROM public.actions')) {
        return { rows: [completedTask({ action_type: 'inspection_defect' })] };
      }
      return { rows: [] };
    });

    await expect(
      correctCompletedWorkshopTask({
        taskId: TASK_ID,
        actorId: 'actor',
        body: {
          reason: 'Try to edit an inspection defect',
          expectedUpdatedAt: UPDATED_AT,
          workshop_comments: 'Should not write',
        },
      })
    ).rejects.toMatchObject({ status: 400 });

    loadServiceConfig.mockResolvedValue(serviceConfig(SERVICE_CATEGORY_ID));
    mockQuery.mockImplementation(async (sql: string) => {
      const normalized = sqlOf(sql);
      if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') {
        return { rows: [] };
      }
      if (normalized.includes('FROM public.actions')) {
        return { rows: [completedTask()] };
      }
      if (normalized.includes('FROM public.workshop_task_categories')) {
        return { rows: [{ id: SERVICE_CATEGORY_ID }] };
      }
      return { rows: [] };
    });

    await expect(
      correctCompletedWorkshopTask({
        taskId: TASK_ID,
        actorId: 'actor',
        body: {
          reason: 'Try to convert into Service',
          expectedUpdatedAt: UPDATED_AT,
          workshop_category_id: SERVICE_CATEGORY_ID,
        },
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('WT-CORR-B1 locks Service identity when only the subcategory parent is Service', async () => {
    const serviceSubcategoryId = '66666666-6666-4666-8666-666666666666';
    const task = completedTask({
      workshop_category_id: null,
      workshop_subcategory_id: serviceSubcategoryId,
    });

    mockQuery.mockImplementation(async (sql: string) => {
      const normalized = sqlOf(sql);
      if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') {
        return { rows: [] };
      }
      if (normalized.includes('FROM public.actions')) {
        return { rows: [task] };
      }
      if (normalized.includes('FROM public.workshop_task_subcategories') && !normalized.includes('JOIN')) {
        return { rows: [{ category_id: SERVICE_CATEGORY_ID }] };
      }
      return { rows: [] };
    });

    await expect(
      correctCompletedWorkshopTask({
        taskId: TASK_ID,
        actorId: 'actor',
        body: {
          reason: 'Try to change Service meter via subcategory',
          expectedUpdatedAt: UPDATED_AT,
          meter_reading: 650153,
        },
      })
    ).rejects.toMatchObject({
      status: 400,
      message: 'Completed Service identity and meter must be corrected with Correct Service',
    });

    mockQuery.mockImplementation(async (sql: string) => {
      const normalized = sqlOf(sql);
      if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') {
        return { rows: [] };
      }
      if (normalized.includes('FROM public.actions')) {
        return { rows: [task] };
      }
      if (normalized.includes('FROM public.workshop_task_subcategories') && !normalized.includes('JOIN')) {
        expect(normalized).toContain('SELECT category_id');
        return { rows: [{ category_id: SERVICE_CATEGORY_ID }] };
      }
      if (normalized.includes('FROM public.hgvs')) {
        return { rows: [{ reg_number: 'SS15 AVS', nickname: null }] };
      }
      if (normalized.includes('FROM public.profiles')) {
        return { rows: [{ full_name: 'Workshop Manager' }] };
      }
      if (normalized.startsWith('UPDATE public.actions')) {
        return { rows: [{ updated_at: '2026-09-07T11:00:00.000Z' }] };
      }
      throw new Error(`Unexpected query: ${normalized}`);
    });

    const result = await correctCompletedWorkshopTask({
      taskId: TASK_ID,
      actorId: 'actor',
      body: {
        reason: 'Correct Service comments only',
        expectedUpdatedAt: UPDATED_AT,
        workshop_comments: 'Corrected Service comments',
      },
    });
    expect(result.updatedAt).toBe('2026-09-07T11:00:00.000Z');
    const updateCall = mockQuery.mock.calls.find((call) => sqlOf(String(call[0])).startsWith('UPDATE public.actions'));
    expect(updateCall?.[1]?.[1]).toBe('Corrected Service comments');
    expect(updateCall?.[1]?.[4]).toBe(100);
    expect(updateCall?.[1]?.[7]).toBe(HGV_ID);
    expect(updateCall?.[1]?.[9]).toBeNull();
    expect(updateCall?.[1]?.[10]).toBe(serviceSubcategoryId);
    expect(mockQuery.mock.calls.some((call) => sqlOf(String(call[0])).startsWith('INSERT INTO public.maintenance_history'))).toBe(false);

    const conflictingSubcategoryId = '99999999-9999-4999-8999-999999999999';
    mockQuery.mockImplementation(async (sql: string) => {
      const normalized = sqlOf(sql);
      if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') {
        return { rows: [] };
      }
      if (normalized.includes('FROM public.actions')) {
        return {
          rows: [completedTask({
            workshop_category_id: SERVICE_CATEGORY_ID,
            workshop_subcategory_id: conflictingSubcategoryId,
          })],
        };
      }
      if (normalized.includes('FROM public.workshop_task_subcategories') && !normalized.includes('JOIN')) {
        return { rows: [{ category_id: BRAKES_CATEGORY_ID }] };
      }
      return { rows: [] };
    });

    await expect(
      correctCompletedWorkshopTask({
        taskId: TASK_ID,
        actorId: 'actor',
        body: {
          reason: 'Try to change Service meter via conflicting category columns',
          expectedUpdatedAt: UPDATED_AT,
          meter_reading: 650153,
        },
      })
    ).rejects.toMatchObject({
      status: 400,
      message: 'Completed Service identity and meter must be corrected with Correct Service',
    });
  });

  it('WT-CORR-B3 revalidates category on asset change and audits description plus meter unit', async () => {
    const vanId = '77777777-7777-4777-8777-777777777777';
    const vanCategoryId = '88888888-8888-4888-8888-888888888888';

    mockQuery.mockImplementation(async (sql: string) => {
      const normalized = sqlOf(sql);
      if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') {
        return { rows: [] };
      }
      if (normalized.includes('FROM public.actions')) {
        return { rows: [completedTask()] };
      }
      if (normalized.includes('FROM public.workshop_task_categories')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    await expect(
      correctCompletedWorkshopTask({
        taskId: TASK_ID,
        actorId: 'actor',
        body: {
          reason: 'Move completed task onto a van',
          expectedUpdatedAt: UPDATED_AT,
          asset_type: 'van',
          vehicle_id: vanId,
        },
      })
    ).rejects.toMatchObject({
      status: 400,
      message: 'Category is not valid for this asset type',
    });

    mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      const normalized = sqlOf(sql);
      if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') {
        return { rows: [] };
      }
      if (normalized.includes('FROM public.actions')) {
        return { rows: [completedTask({ description: 'Original workshop notes' })] };
      }
      if (normalized.includes('FROM public.workshop_task_categories')) {
        expect(normalized).toContain('applies_to = $2');
        expect(params?.[0]).toBe(vanCategoryId);
        expect(params?.[1]).toBe('van');
        return { rows: [{ id: vanCategoryId }] };
      }
      if (normalized.includes('FROM public.vans')) {
        return { rows: [{ reg_number: 'AB12 CDE', nickname: null }] };
      }
      if (normalized.includes('FROM public.profiles')) {
        return { rows: [{ full_name: 'Workshop Manager' }] };
      }
      if (normalized.startsWith('UPDATE public.actions')) {
        return { rows: [{ updated_at: '2026-09-07T11:05:00.000Z' }] };
      }
      throw new Error(`Unexpected query: ${normalized}`);
    });

    const result = await correctCompletedWorkshopTask({
      taskId: TASK_ID,
      actorId: 'actor',
      body: {
        reason: 'Move completed task onto a van',
        expectedUpdatedAt: UPDATED_AT,
        workshop_comments: 'Corrected van notes after move',
        asset_type: 'van',
        vehicle_id: vanId,
        workshop_category_id: vanCategoryId,
      },
    });
    expect(result.updatedAt).toBe('2026-09-07T11:05:00.000Z');
    const updateCall = mockQuery.mock.calls.find((call) => sqlOf(String(call[0])).startsWith('UPDATE public.actions'));
    expect(updateCall?.[1]?.[2]).toBe('Corrected van notes after move');
    expect(updateCall?.[1]?.[5]).toBe('miles');
    expect(updateCall?.[1]?.[6]).toBe(vanId);
    expect(updateCall?.[1]?.[7]).toBeNull();
    expect(updateCall?.[1]?.[9]).toBe(vanCategoryId);
    const history = JSON.parse(String(updateCall?.[1]?.[11])) as Array<{
      status: string;
      meta?: { before?: Record<string, unknown>; after?: Record<string, unknown> };
    }>;
    const correction = history.at(-1);
    expect(correction?.status).toBe('corrected');
    expect(correction?.meta?.before).toMatchObject({
      description: 'Original workshop notes',
      asset_meter_unit: 'km',
      hgv_id: HGV_ID,
    });
    expect(correction?.meta?.after).toMatchObject({
      description: 'Corrected van notes after move',
      asset_meter_unit: 'miles',
      van_id: vanId,
      hgv_id: null,
      workshop_category_id: vanCategoryId,
    });
  });

  it('WT-CORR-CONFLICT-001 rejects stale task timestamps and no-ops', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      const normalized = sqlOf(sql);
      if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') {
        return { rows: [] };
      }
      if (normalized.includes('FROM public.actions')) {
        return { rows: [completedTask()] };
      }
      if (normalized.includes('FROM public.hgvs')) {
        return { rows: [{ reg_number: 'SS15 AVS', nickname: null }] };
      }
      if (normalized.includes('FROM public.profiles')) {
        return { rows: [{ full_name: 'Workshop Manager' }] };
      }
      return { rows: [] };
    });

    await expect(
      correctCompletedWorkshopTask({
        taskId: TASK_ID,
        actorId: 'actor',
        body: {
          reason: 'Stale correction attempt',
          expectedUpdatedAt: '2026-09-07T09:00:00.000Z',
          workshop_comments: 'Corrected workshop notes',
        },
      })
    ).rejects.toMatchObject({ status: 409 });

    await expect(
      correctCompletedWorkshopTask({
        taskId: TASK_ID,
        actorId: 'actor',
        body: {
          reason: 'No-op correction attempt',
          expectedUpdatedAt: UPDATED_AT,
          workshop_comments: 'Original workshop notes',
        },
      })
    ).rejects.toMatchObject({ status: 409 });
  });

  it('WT-CORR-ATT-001 writes changed responses and an immutable audit row', async () => {
    const previous = canonicalizeAttachmentResponses([
      { section_key: 'details', field_key: 'odometer_reading', response_value: '640000' },
    ]);
    const currentHash = hashAttachmentResponses(previous);
    mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      const normalized = sqlOf(sql);
      if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') {
        return { rows: [] };
      }
      if (normalized.includes('FROM public.workshop_task_attachments')) {
        return { rows: [{ id: ATTACHMENT_ID, task_id: TASK_ID, status: 'completed' }] };
      }
      if (normalized.includes('FROM public.actions')) {
        return { rows: [{ id: TASK_ID, status: 'completed', action_type: 'workshop_vehicle_task' }] };
      }
      if (normalized.includes('FROM public.workshop_attachment_schema_snapshots')) {
        return {
          rows: [{
            snapshot_json: {
              sections: [{
                section_key: 'details',
                fields: [{ field_key: 'odometer_reading' }],
              }],
            },
          }],
        };
      }
      if (normalized.includes('FROM public.workshop_attachment_field_responses')) {
        return { rows: previous };
      }
      if (normalized.includes('INSERT INTO public.workshop_attachment_field_responses')) {
        expect(params?.[5] ?? params?.[4]).toBeDefined();
        return { rows: [] };
      }
      if (normalized.includes('FROM public.profiles')) {
        return { rows: [{ full_name: 'Workshop Manager' }] };
      }
      if (normalized.includes('INSERT INTO public.workshop_attachment_corrections')) {
        expect(params?.[4]).toBe('Correct recorded odometer reading');
        expect(params?.[5]).toEqual(['details::odometer_reading']);
        return { rows: [{ id: 'corr-1' }] };
      }
      throw new Error(`Unexpected query: ${normalized}`);
    });

    const result = await correctCompletedAttachmentResponses({
      attachmentId: ATTACHMENT_ID,
      actorId: 'actor',
      body: {
        reason: 'Correct recorded odometer reading',
        expectedPreimageHash: currentHash,
        responses: [
          { section_key: 'details', field_key: 'odometer_reading', response_value: '650153' },
        ],
      },
    });

    expect(result.correctionId).toBe('corr-1');
    expect(mockQuery.mock.calls.some((call) => sqlOf(String(call[0])).includes('INSERT INTO public.workshop_attachment_corrections'))).toBe(true);
    expect(mockQuery.mock.calls.some((call) => sqlOf(String(call[0])).includes('UPDATE public.workshop_task_attachments'))).toBe(false);
    expect(mockQuery.mock.calls.some((call) => sqlOf(String(call[0])).includes("status = 'completed'"))).toBe(false);
  });

  it('WT-CORR-ATT-002 rejects invalid required responses and keeps completed rows locked', async () => {
    validateRequiredSchemaResponses.mockReturnValue(['odometer_reading is required']);
    const previous = canonicalizeAttachmentResponses([
      { section_key: 'details', field_key: 'odometer_reading', response_value: '640000' },
    ]);
    mockQuery.mockImplementation(async (sql: string) => {
      const normalized = sqlOf(sql);
      if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') {
        return { rows: [] };
      }
      if (normalized.includes('FROM public.workshop_task_attachments')) {
        return { rows: [{ id: ATTACHMENT_ID, task_id: TASK_ID, status: 'completed' }] };
      }
      if (normalized.includes('FROM public.actions')) {
        return { rows: [{ id: TASK_ID, status: 'completed', action_type: 'workshop_vehicle_task' }] };
      }
      if (normalized.includes('FROM public.workshop_attachment_schema_snapshots')) {
        return {
          rows: [{
            snapshot_json: {
              sections: [{
                section_key: 'details',
                fields: [{ field_key: 'odometer_reading' }],
              }],
            },
          }],
        };
      }
      if (normalized.includes('FROM public.workshop_attachment_field_responses')) {
        return { rows: previous };
      }
      throw new Error(`Unexpected write: ${normalized}`);
    });

    await expect(
      correctCompletedAttachmentResponses({
        attachmentId: ATTACHMENT_ID,
        actorId: 'actor',
        body: {
          reason: 'Correct recorded odometer reading',
          expectedPreimageHash: hashAttachmentResponses(previous),
          responses: [
            { section_key: 'details', field_key: 'odometer_reading', response_value: '' },
          ],
        },
      })
    ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/required/i) });
    expect(mockQuery.mock.calls.some((call) => sqlOf(String(call[0])).includes('INSERT INTO'))).toBe(false);
  });

  it('does not treat correction history as the latest completion', () => {
    const latest = getLatestCompletedEvent([
      {
        id: 'c1',
        type: 'status',
        status: 'completed',
        created_at: '2026-09-01T09:00:00.000Z',
        author_id: 'actor',
      },
      {
        id: 'x1',
        type: 'status',
        status: 'corrected',
        created_at: '2026-09-07T11:00:00.000Z',
        author_id: 'actor',
        meta: { event_kind: 'completed_task_correction' },
      },
    ]);
    expect(latest?.id).toBe('c1');
  });
});
