import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { hgvDailyCheckUpdatesEnabled } from '@/lib/server/hgv-update-capabilities';
import { createAdminClient } from '@/lib/supabase/admin';
import { TRUCK_CHECKLIST_ITEMS } from '@/lib/checklists/vehicle-checklists';
import type { InspectionStatus } from '@/types/inspection';

export const HGV_INSPECTION_SAVE_RPC = 'save_hgv_inspection_v2';
export const HGV_INSPECTION_COMPAT_RPC = 'save_hgv_inspection_compat';
export const HGV_INSPECTION_SAVE_FORBIDDEN = 'Forbidden: cannot save this inspection';

const InspectionItemSchema = z
  .object({
    item_number: z.number().int().positive(),
    item_description: z.string().min(1),
    day_of_week: z.number().int().min(1).max(7),
    status: z.enum(['ok', 'attention', 'defect', 'na']),
    comments: z.string().nullable(),
  })
  .strict();

export const HgvInspectionSaveBodySchema = z
  .object({
    hintInspectionId: z.string().uuid().nullable().optional(),
    requestId: z.string().uuid().optional(),
    recordKind: z.enum(['full_check', 'defect_report']).default('full_check'),
    parentCheckId: z.string().uuid().nullable().optional(),
    discoveredAt: z.string().datetime().nullable().optional(),
    correctionReason: z.string().trim().min(5).max(1000).nullable().optional(),
    expectedRevision: z.number().int().nonnegative().nullable().optional(),
    informWorkshop: z.boolean().default(false),
    hgvId: z.string().uuid(),
    userId: z.string().uuid(),
    inspectionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    currentMileage: z.number().int().nonnegative().nullable(),
    status: z.enum(['draft', 'submitted']),
    inspectorComments: z.string().nullable(),
    signatureData: z.string().nullable().optional(),
    items: z.array(InspectionItemSchema),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.status === 'submitted') {
      if (!body.signatureData?.startsWith('data:image/png;base64,')) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['signatureData'], message: 'Signature required' });
      if (body.recordKind === 'full_check' && body.items.length !== TRUCK_CHECKLIST_ITEMS.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['items'], message: 'Complete all checklist items' });
      if (body.recordKind === 'defect_report' && (!body.parentCheckId || !body.discoveredAt || !body.items.length || body.items.some(item => item.status !== 'attention'))) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['items'], message: 'Report at least one defect' });
    }
    const seen = new Set<string>();
    for (const item of body.items) {
      if (TRUCK_CHECKLIST_ITEMS[item.item_number - 1] !== item.item_description) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['items'], message: 'Unknown checklist item' });
      const key = `${item.item_number}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items'],
          message: 'Duplicate inspection item keys are not allowed',
        });
        return;
      }
      seen.add(key);
    }
  });

export type HgvInspectionSaveBody = z.infer<typeof HgvInspectionSaveBodySchema>;

export type HgvInspectionSavedItem = {
  id: string;
  item_number: number;
  item_description: string | null;
  day_of_week: number | null;
  status: InspectionStatus;
  comments: string | null;
};

export type HgvInspectionSaveResult = {
  id: string;
  status: 'draft' | 'submitted';
  items: HgvInspectionSavedItem[];
  revision: number;
};

export type HgvInspectionWriteAuthorization =
  | { ok: true }
  | { ok: false; status: 403; error: string };

type HgvInspectionLookupRow = {
  id: string;
  user_id: string;
  status: 'draft' | 'submitted';
};

export type HgvInspectionSaveResolution = {
  existing: HgvInspectionLookupRow | null;
  sanitizedHintId: string | null;
};

type AdminRpc = {
  rpc(fn: typeof HGV_INSPECTION_SAVE_RPC | typeof HGV_INSPECTION_COMPAT_RPC, args: Record<string, unknown>): Promise<{ data: HgvInspectionSaveResult | null; error: { message: string } | null }>;
};

type LookupQuery = {
  select(columns: string): LookupQuery;
  eq(column: string, value: string): LookupQuery;
  maybeSingle(): Promise<{ data: HgvInspectionLookupRow | null; error: { message: string } | null }>;
};

export type HgvInspectionSaveAdmin = {
  from(table: string): unknown;
  rpc: AdminRpc['rpc'];
};

export function actorCanWriteInspectionOwner(
  actorId: string,
  canManageOthers: boolean,
  ownerId: string
): boolean {
  return actorId === ownerId || canManageOthers;
}

export function authorizeHgvInspectionWrite(input: {
  actorId: string;
  canManageOthers: boolean;
  existingOwnerId: string | null;
  subjectUserId: string;
}): HgvInspectionWriteAuthorization {
  if (
    input.existingOwnerId &&
    !actorCanWriteInspectionOwner(input.actorId, input.canManageOthers, input.existingOwnerId)
  ) {
    return { ok: false, status: 403, error: HGV_INSPECTION_SAVE_FORBIDDEN };
  }

  if (!actorCanWriteInspectionOwner(input.actorId, input.canManageOthers, input.subjectUserId)) {
    return { ok: false, status: 403, error: HGV_INSPECTION_SAVE_FORBIDDEN };
  }

  return { ok: true };
}

export function forbiddenHgvInspectionSaveError(): Error & { status: number; code: string } {
  const error = new Error(HGV_INSPECTION_SAVE_FORBIDDEN) as Error & { status: number; code: string };
  error.status = 403;
  error.code = 'FORBIDDEN';
  return error;
}

export function mapHgvSaveRpcError(message: string): { status: number; error: string; code: string } {
  if (message.includes('HGV_SAVE:COMPAT_CHECK_EXISTS')) return { status: 409, error: 'A check already exists for this HGV and date. Open it from HGV Daily Checks. Your new answers have not been saved.', code: 'COMPAT_CHECK_EXISTS' };
  if (message.includes('HGV_SAVE:COMPAT_REFRESH_REQUIRED')) return { status: 409, error: 'This check has changed or more than one check exists. Refresh HGV Daily Checks and open the specific draft. Your new answers have not been saved.', code: 'COMPAT_REFRESH_REQUIRED' };
  if (message.includes('HGV_SAVE:FORBIDDEN_OWNER') || message.includes('HGV_SAVE:FORBIDDEN_SUBJECT')) {
    return { status: 403, error: HGV_INSPECTION_SAVE_FORBIDDEN, code: 'FORBIDDEN' };
  }
  if (message.includes('HGV_SAVE:CORRECTION_EXPIRED')) return { status: 409, error: 'Corrections are only allowed on the day the check was submitted (UK time).', code: 'CORRECTION_EXPIRED' };
  if (message.includes('HGV_SAVE:REVISION_CONFLICT') || message.includes('HGV_SAVE:IDENTITY_CHANGED')) return { status: 409, error: 'This check has changed. Refresh it before trying again.', code: 'REVISION_CONFLICT' };
  if (message.includes('HGV_SAVE:SUBMITTED_CONFLICT')) {
    return {
      status: 409,
      error: 'This check is already submitted. View it to report a new defect, correct it, or start another check.',
      code: 'SUBMITTED_CONFLICT',
    };
  }
  if (message.includes('HGV_SAVE:OWNERSHIP_CHANGED') || message.includes('HGV_SAVE:NOT_FOUND')) {
    return {
      status: 409,
      error: 'This draft could not be saved. It may have been submitted, removed, or your session may have expired. Refresh and try again.',
      code: 'OWNERSHIP_CHANGED',
    };
  }
  if (message.includes('HGV_SAVE:INVALID_ITEM') || message.includes('HGV_SAVE:INVALID_STATUS') || message.includes('HGV_SAVE:INVALID_INPUT')) {
    return { status: 400, error: 'Invalid inspection save payload', code: 'INVALID_INPUT' };
  }
  return { status: 500, error: 'Failed to save HGV inspection', code: 'SAVE_FAILED' };
}

function asLookupQuery(value: unknown): LookupQuery {
  return value as LookupQuery;
}

export async function resolveHgvInspectionForSave(
  admin: Pick<HgvInspectionSaveAdmin, 'from'>,
  input: Pick<HgvInspectionSaveBody, 'hgvId' | 'userId' | 'inspectionDate' | 'hintInspectionId'>,
  access: { actorId: string; canManageOthers: boolean }
): Promise<HgvInspectionSaveResolution> {
  if (!input.hintInspectionId) {
    return { existing: null, sanitizedHintId: null };
  }

  let hintQuery = asLookupQuery(admin.from('hgv_inspections'))
    .select('id, user_id, status')
    .eq('id', input.hintInspectionId);
  if (!access.canManageOthers) {
    hintQuery = hintQuery.eq('user_id', access.actorId);
  }
  const { data: byHint, error: hintError } = await hintQuery.maybeSingle();

  if (hintError) {
    throw hintError;
  }
  if (
    !byHint ||
    !actorCanWriteInspectionOwner(access.actorId, access.canManageOthers, byHint.user_id)
  ) {
    throw forbiddenHgvInspectionSaveError();
  }

  return { existing: byHint, sanitizedHintId: byHint.id };
}

export async function lookupHgvInspectionForSave(
  admin: Pick<HgvInspectionSaveAdmin, 'from'>,
  input: Pick<HgvInspectionSaveBody, 'hgvId' | 'userId' | 'inspectionDate' | 'hintInspectionId'>,
  access: { actorId: string; canManageOthers: boolean }
): Promise<HgvInspectionLookupRow | null> {
  const resolved = await resolveHgvInspectionForSave(admin, input, access);
  return resolved.existing;
}

export async function saveHgvInspectionForActor(input: {
  actorId: string;
  canManageOthers: boolean;
  body: HgvInspectionSaveBody;
  admin?: HgvInspectionSaveAdmin;
}): Promise<HgvInspectionSaveResult> {
  const updatesEnabled = hgvDailyCheckUpdatesEnabled();
  if (!updatesEnabled && (input.body.recordKind !== 'full_check' || input.body.correctionReason || input.body.parentCheckId)) {
    const error = new Error('Additional reports and corrections are not enabled on this site.') as Error & { status: number; code: string };
    error.status = 403;
    error.code = 'FEATURE_DISABLED';
    throw error;
  }
  const subjectAuthorization = authorizeHgvInspectionWrite({
    actorId: input.actorId,
    canManageOthers: input.canManageOthers,
    existingOwnerId: null,
    subjectUserId: input.body.userId,
  });
  if (!subjectAuthorization.ok) {
    throw forbiddenHgvInspectionSaveError();
  }

  const admin = input.admin ?? (createAdminClient() as unknown as HgvInspectionSaveAdmin);
  const resolved = await resolveHgvInspectionForSave(admin, input.body, {
    actorId: input.actorId,
    canManageOthers: input.canManageOthers,
  });
  const ownerAuthorization = authorizeHgvInspectionWrite({
    actorId: input.actorId,
    canManageOthers: input.canManageOthers,
    existingOwnerId: resolved.existing?.user_id ?? null,
    subjectUserId: input.body.userId,
  });
  if (!ownerAuthorization.ok) {
    throw forbiddenHgvInspectionSaveError();
  }

  const rpcClient = admin;
  // An old cached form has no request ID: always use the locked compatibility adapter.
  const { data, error } = await rpcClient.rpc(updatesEnabled && input.body.requestId ? HGV_INSPECTION_SAVE_RPC : HGV_INSPECTION_COMPAT_RPC, {
    p_actor_id: input.actorId,
    p_actor_can_manage_others: input.canManageOthers,
    p_subject_user_id: input.body.userId,
    p_hgv_id: input.body.hgvId,
    p_inspection_date: input.body.inspectionDate,
    p_hint_inspection_id: input.body.hintInspectionId ?? null,
    p_request_id: input.body.requestId ?? randomUUID(),
    p_record_kind: input.body.recordKind,
    p_parent_check_id: input.body.parentCheckId ?? null,
    p_discovered_at: input.body.discoveredAt ?? null,
    p_correction_reason: input.body.correctionReason ?? null,
    p_expected_revision: input.body.expectedRevision ?? null,
    p_inform_workshop: input.body.informWorkshop,
    p_status: input.body.status,
    p_current_mileage: input.body.currentMileage,
    p_inspector_comments: input.body.inspectorComments,
    p_signature_data: input.body.signatureData ?? null,
    p_items: input.body.items,
  });

  if (error || !data) {
    const mapped = mapHgvSaveRpcError(error?.message ?? 'HGV_SAVE:NOT_FOUND');
    const rpcError = new Error(mapped.error) as Error & { status: number; code: string };
    rpcError.status = mapped.status;
    rpcError.code = mapped.code;
    throw rpcError;
  }

  return data;
}
