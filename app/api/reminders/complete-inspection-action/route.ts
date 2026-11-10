import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import {
  completeReminderActionForAsset,
  completeVanDraftSubmissionReminder,
} from '@/lib/server/reminders/complete-reminder-action';
import { getReminderActionRequiredModule } from '@/lib/utils/reminder-action-permissions';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { logServerError } from '@/lib/utils/server-error-logger';
import type { ReminderAssetType } from '@/types/reminders';
import { getInspectionRouteActorAccess } from '@/lib/server/inspection-route-access';

const completeInspectionReminderSchema = z.object({
  assetType: z.enum(['van', 'plant', 'hgv']),
  assetId: z.string().trim().min(1),
  assignedTo: z.string().trim().uuid(),
  draftInspectionId: z.string().trim().uuid().optional(),
  inspectionId: z.string().trim().uuid().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const current = await getCurrentAuthenticatedProfile();
    if (!current) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = completeInspectionReminderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid reminder completion request' }, { status: 400 });
    }

    const assetType = parsed.data.assetType as ReminderAssetType;
    const requiredModule = getReminderActionRequiredModule(assetType);
    const canCompleteFromModule = await canEffectiveRoleAccessModule(requiredModule);
    if (!canCompleteFromModule) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (parsed.data.draftInspectionId && (assetType !== 'van' ||
        (parsed.data.inspectionId && parsed.data.inspectionId !== parsed.data.draftInspectionId))) {
      return NextResponse.json({ error: 'Draft reminder must match the submitted Van Daily Check' }, { status: 400 });
    }
    const sourceId = parsed.data.inspectionId ?? parsed.data.draftInspectionId;
    const admin = createAdminClient();
    if (sourceId) {
      const table = assetType === 'van' ? 'van_inspections' : assetType === 'plant' ? 'plant_inspections' : 'hgv_inspections';
      const { data: check, error } = await admin.from(table).select('user_id, status')
        .eq('id', sourceId).eq(`${assetType}_id`, parsed.data.assetId).maybeSingle();
      if (error) throw error;
      if (!check) return NextResponse.json({ error: 'Daily Check not found' }, { status: 404 });
      const { access, errorResponse } = await getInspectionRouteActorAccess(requiredModule);
      if (errorResponse || !access) return errorResponse ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      if ((check.user_id !== current.profile.id && !access.canManageOthers) ||
          check.user_id !== parsed.data.assignedTo || check.status !== 'submitted') {
        return NextResponse.json({ error: 'Forbidden: submitted Daily Check access required' }, { status: 403 });
      }
    }
    const assetResult = await completeReminderActionForAsset({
      admin,
      assetType,
      assetId: parsed.data.assetId,
      assignedTo: parsed.data.assignedTo,
      actionedBy: current.profile.id,
      inspectionId: sourceId,
    });
    const draftResult = parsed.data.draftInspectionId
      ? await completeVanDraftSubmissionReminder({
          admin,
          draftInspectionId: parsed.data.draftInspectionId,
          assignedTo: parsed.data.assignedTo,
          actionedBy: current.profile.id,
        })
      : null;

    return NextResponse.json({
      success: true,
      actionedCount: assetResult.actionedCount + (draftResult?.actionedCount || 0),
      cancelledCount: assetResult.cancelledCount + (draftResult?.cancelledCount || 0),
      actionIds: Array.from(new Set([
        ...assetResult.actionIds,
        ...(draftResult?.actionIds || []),
      ])),
      assetResult,
      draftResult,
    });
  } catch (error) {
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/reminders/complete-inspection-action',
      additionalData: {
        endpoint: 'POST /api/reminders/complete-inspection-action',
      },
    });

    return NextResponse.json(
      { error: 'Failed to complete reminder' },
      { status: 500 },
    );
  }
}
