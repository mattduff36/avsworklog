import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ type: 'van', query: vi.fn() }));
vi.mock('pg', () => ({ default: { Client: class {
  connect = vi.fn(); end = vi.fn(); query = state.query;
} } }));
import { insertWorkshopTaskAttachmentExactOne, validateWorkshopServiceChoice } from '@/lib/server/asset-service';
beforeEach(() => {
  vi.stubEnv('POSTGRES_URL_NON_POOLING', 'postgres://fixture:fixture@localhost:5432/fixture');
  state.query.mockReset();
  state.query.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM public.actions a')) return { rows: [{ category_id: 'service', van_id: state.type === 'van' ? 'asset' : null, hgv_id: state.type === 'hgv' ? 'asset' : null }] };
    if (sql.includes('FROM public.maintenance_categories')) return { rows: [{ id: 'config', workshop_category_id: 'service', period_value: 10000, period_unit: 'miles' }] };
    if (sql.includes('FROM public.vehicle_maintenance')) return { rows: [{ next_service_template_id: 'full' }] };
    if (sql.includes('FROM public.service_rotation_steps')) return { rows: [{ id: 'step-a', position: 1, attachment_template_id: 'basic' }, { id: 'step-full', position: 2, attachment_template_id: 'full' }] };
    if (sql.includes('FROM public.workshop_category_attachment_templates')) return { rows: [{ template_id: 'basic' }, { template_id: 'full' }] };
    if (sql.includes('INSERT INTO public.workshop_task_attachments')) return { rows: [{ id: 'attachment' }] };
    return { rows: [], rowCount: 0 };
  });
});
it.each(['van', 'hgv'] as const)('rejects invalid or unauthorised %s selection before task creation', async (assetType) => {
  const input = { assetType, assetId: 'asset', categoryId: 'service', subcategoryId: null, templateId: 'basic', canOverride: false };
  await expect(validateWorkshopServiceChoice(input)).rejects.toMatchObject({ status: 403 });
  await expect(validateWorkshopServiceChoice({ ...input, templateId: null })).rejects.toMatchObject({ status: 400 });
  await expect(validateWorkshopServiceChoice({ ...input, templateId: 'full' })).resolves.toBeUndefined();
  await expect(validateWorkshopServiceChoice({ ...input, canOverride: true })).resolves.toBeUndefined();
  expect(state.query.mock.calls.some(([sql]) => /INSERT|UPDATE/.test(sql))).toBe(false);
});
afterEach(() => vi.unstubAllEnvs());
it.each(['van', 'hgv'])('enforces the scheduled %s type below Supervisor and allows an explicit Supervisor override', async (type) => {
  state.type = type;
  const input = { taskId: 'task', actorId: 'actor', templateName: 'Basic', templateId: 'basic' };
  await expect(insertWorkshopTaskAttachmentExactOne(input)).rejects.toMatchObject({ status: 403 });
  expect(state.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO'))).toBe(false);
  await expect(insertWorkshopTaskAttachmentExactOne({ ...input, templateId: 'full' })).resolves.toEqual({ id: 'attachment' });
  await expect(insertWorkshopTaskAttachmentExactOne({ ...input, canOverrideServiceType: true })).resolves.toEqual({ id: 'attachment' });
  expect(state.query.mock.calls.some(([sql]) => /UPDATE public.vehicle_maintenance/.test(sql))).toBe(false);
});
