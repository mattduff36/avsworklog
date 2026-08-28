import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import type { InspectionStatus } from '@/types/inspection';

export const HGV_INSPECTION_SAVE_RPC = 'save_hgv_inspection';

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
    hgvId: z.string().uuid(),
    userId: z.string().uuid(),
    inspectionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    currentMileage: z.number().int().nonnegative().nullable(),
    status: z.enum(['draft', 'submitted']),
    inspectorComments: z.string().nullable(),
    signatureData: z.string().nullable().optional(),
    items: z.array(InspectionItemSchema),
  })
  .strict();

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
};

export type HgvInspectionWriteAuthorization =
  | { ok: true }
  | { ok: false; status: 403; error: string };

type HgvInspectionLookupRow = {
  id: string;
  user_id: string;
  status: 'draft' | 'submitted';
};

type AdminRpc = {
  rpc(
    fn: typeof HGV_INSPECTION_SAVE_RPC,
    args: {
      p_actor_id: string;
      p_actor_can_manage_others: boolean;
      p_subject_user_id: string;
      p_hgv_id: string;
      p_inspection_date: string;
      p_hint_inspection_id: string | null;
      p_expected_owner_id: string | null;
      p_status: 'draft' | 'submitted';
      p_current_mileage: number | null;
      p_inspector_comments: string | null;
      p_signature_data: string | null;
      p_items: HgvInspectionSaveBody['items'];
    }
  ): Promise<{ data: HgvInspectionSaveResult | null; error: { message: string } | null }>;
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
    return { ok: false, status: 403, error: 'Forbidden: cannot edit another user draft' };
  }

  if (!actorCanWriteInspectionOwner(input.actorId, input.canManageOthers, input.subjectUserId)) {
    return { ok: false, status: 403, error: 'Forbidden: cannot save for another user' };
  }

  return { ok: true };
}

export function mapHgvSaveRpcError(message: string): { status: number; error: string; code: string } {
  if (message.includes('HGV_SAVE:FORBIDDEN_OWNER') || message.includes('HGV_SAVE:FORBIDDEN_SUBJECT')) {
    return { status: 403, error: 'Forbidden: cannot save this inspection', code: 'FORBIDDEN' };
  }
  if (message.includes('HGV_SAVE:SUBMITTED_CONFLICT')) {
    return {
      status: 409,
      error: 'A daily check has already been submitted for this employee, HGV and date.',
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

export async function lookupHgvInspectionForSave(
  admin: ReturnType<typeof createAdminClient>,
  input: Pick<HgvInspectionSaveBody, 'hgvId' | 'userId' | 'inspectionDate' | 'hintInspectionId'>
): Promise<HgvInspectionLookupRow | null> {
  const { data: byKey, error: keyError } = await admin
    .from('hgv_inspections')
    .select('id, user_id, status')
    .eq('hgv_id', input.hgvId)
    .eq('user_id', input.userId)
    .eq('inspection_date', input.inspectionDate)
    .maybeSingle();

  if (keyError) {
    throw keyError;
  }
  if (byKey) {
    return byKey;
  }

  if (!input.hintInspectionId) {
    return null;
  }

  const { data: byHint, error: hintError } = await admin
    .from('hgv_inspections')
    .select('id, user_id, status')
    .eq('id', input.hintInspectionId)
    .maybeSingle();

  if (hintError) {
    throw hintError;
  }
  if (!byHint || byHint.status !== 'draft') {
    return null;
  }
  return byHint;
}

export async function saveHgvInspectionForActor(input: {
  actorId: string;
  canManageOthers: boolean;
  body: HgvInspectionSaveBody;
  admin?: ReturnType<typeof createAdminClient>;
}): Promise<HgvInspectionSaveResult> {
  const admin = input.admin ?? createAdminClient();
  const existing = await lookupHgvInspectionForSave(admin, input.body);
  const authorization = authorizeHgvInspectionWrite({
    actorId: input.actorId,
    canManageOthers: input.canManageOthers,
    existingOwnerId: existing?.user_id ?? null,
    subjectUserId: input.body.userId,
  });
  if (!authorization.ok) {
    const error = new Error(authorization.error) as Error & { status: number; code: string };
    error.status = authorization.status;
    error.code = 'FORBIDDEN';
    throw error;
  }

  const rpcClient = admin as unknown as AdminRpc;
  const { data, error } = await rpcClient.rpc(HGV_INSPECTION_SAVE_RPC, {
    p_actor_id: input.actorId,
    p_actor_can_manage_others: input.canManageOthers,
    p_subject_user_id: input.body.userId,
    p_hgv_id: input.body.hgvId,
    p_inspection_date: input.body.inspectionDate,
    p_hint_inspection_id: input.body.hintInspectionId ?? null,
    p_expected_owner_id: existing?.user_id ?? null,
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
