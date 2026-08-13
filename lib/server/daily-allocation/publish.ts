import { z } from 'zod';
import { canEffectiveRoleUseModuleLevel } from '@/lib/utils/rbac';
import {
  DailyAllocationError,
  blankToNull,
  callDailyAllocationRpc,
  isWorkDate,
  mapPostgresError,
  parseWithSchema,
  requireDailyAllocationManagerMutation,
  requireDailyAllocationMutation,
} from '@/lib/server/daily-allocation/auth';

export const publishV1Schema = z.object({
  snapshot_version: z.literal(1).optional(),
  work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A valid work date is required.'),
  idempotency_key: z.string().trim().min(1, 'Idempotency key is required.'),
  plan_day_id: z.string().uuid().optional(),
  expected_plan_version: z.number().int().positive().optional(),
  confirm_unallocated: z.boolean().optional(),
});

export const publishV2Schema = z.object({
  snapshot_version: z.literal(2),
  plan_day_id: z.string().uuid('A plan day is required.'),
  expected_plan_version: z.number().int().positive(),
  idempotency_key: z.string().trim().min(1, 'Idempotency key is required.'),
  confirm_unallocated: z.boolean().optional().default(false),
  work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export function isDailyAllocationV2Publish(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const record = body as Record<string, unknown>;
  if (record.snapshot_version === 2) return true;
  if (record.snapshot_version === 1) return false;
  return typeof record.plan_day_id === 'string' && record.plan_day_id.length > 0;
}

export async function publishDailyAllocation(workDate: string, idempotencyKey: string) {
  const { supabase } = await requireDailyAllocationMutation();
  const canManage = await canEffectiveRoleUseModuleLevel('daily-allocation', 4);
  if (!canManage) throw new DailyAllocationError('Manager-level daily allocation access is required.', 403);
  if (!isWorkDate(workDate)) throw new DailyAllocationError('A valid work date is required.', 400);
  const key = blankToNull(idempotencyKey);
  if (!key) throw new DailyAllocationError('Idempotency key is required.', 400);

  const insert = await supabase
    .from('daily_allocation_publications')
    .insert({
      work_date: workDate,
      idempotency_key: key,
    })
    .select('id, work_date, revision_no, published_at, published_by')
    .maybeSingle();

  if (insert.error?.code === '23505') {
    const existing = await supabase
      .from('daily_allocation_publications')
      .select('id, work_date, revision_no, published_at, published_by')
      .eq('idempotency_key', key)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) return existing.data;
  }

  if (insert.error) throw mapPostgresError(insert.error) || insert.error;
  if (!insert.data) throw new DailyAllocationError('Unable to publish this allocation.', 500);
  return insert.data;
}

export async function publishDailyAllocationPlanV2(input: {
  plan_day_id: string;
  expected_plan_version: number;
  idempotency_key: string;
  confirm_unallocated?: boolean;
}): Promise<{ publication_id: string; snapshot_version: 2 }> {
  const { supabase } = await requireDailyAllocationManagerMutation();
  const parsed = parseWithSchema(publishV2Schema, {
    snapshot_version: 2,
    ...input,
  }, 'Invalid v2 publish request.');
  const publicationId = await callDailyAllocationRpc<string>(supabase, 'publish_daily_allocation_plan_v2', {
    p_plan_day_id: parsed.plan_day_id,
    p_expected_plan_version: parsed.expected_plan_version,
    p_idempotency_key: parsed.idempotency_key,
    p_confirm_unallocated: parsed.confirm_unallocated,
  });
  return { publication_id: publicationId, snapshot_version: 2 };
}

export async function publishDailyAllocationFromBody(body: unknown) {
  if (isDailyAllocationV2Publish(body)) {
    const parsed = parseWithSchema(publishV2Schema, {
      ...(typeof body === 'object' && body ? body : {}),
      snapshot_version: 2,
    }, 'Invalid v2 publish request.');
    return publishDailyAllocationPlanV2(parsed);
  }

  const parsed = parseWithSchema(publishV1Schema, body, 'Invalid publish request.');
  const publication = await publishDailyAllocation(parsed.work_date, parsed.idempotency_key);
  return { publication, snapshot_version: 1 as const };
}
