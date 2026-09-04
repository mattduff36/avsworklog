import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { applyValidationCookieIfNeeded } from '@/lib/server/app-auth/response';
import type { AppSessionValidationResult } from '@/lib/server/app-auth/session';
import { requireWorkshopTasksAccess } from '@/lib/server/workshop-tasks/auth';
import {
  isAssetIdUuid,
  isWorkshopAssetType,
  loadAssetWhereabouts,
} from '@/lib/server/workshop-tasks/asset-whereabouts';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { logServerError } from '@/lib/utils/server-error-logger';

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store',
};

function jsonWithSession(
  validation: AppSessionValidationResult,
  body: unknown,
  status = 200
): NextResponse {
  const response = NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
  applyValidationCookieIfNeeded(response, validation);
  return response;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ assetType: string; assetId: string }> }
) {
  const access = await requireWorkshopTasksAccess();
  try {
    if (!access.ok) {
      return jsonWithSession(
        access.validation,
        { error: access.status === 401 ? 'Unauthorized' : 'Forbidden: Workshop Tasks access required' },
        access.status
      );
    }

    const { assetType, assetId } = await context.params;
    if (!isWorkshopAssetType(assetType) || !isAssetIdUuid(assetId)) {
      return jsonWithSession(access.validation, { error: 'A valid asset is required' }, 400);
    }

    const admin = createAdminClient();
    const canOpenFleetHistory = await canEffectiveRoleAccessModule('admin-vans', {
      userId: access.userId,
      email: access.validation.email,
    });
    const payload = await loadAssetWhereabouts({
      admin,
      assetType,
      assetId,
      canOpenFleetHistory,
    });

    if (!payload) {
      return jsonWithSession(access.validation, { error: 'Asset not found' }, 404);
    }

    return jsonWithSession(access.validation, payload);
  } catch (error) {
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/workshop-tasks/assets/whereabouts',
      additionalData: {
        endpoint: 'GET /api/workshop-tasks/assets/[assetType]/[assetId]/whereabouts',
      },
    });
    return jsonWithSession(
      access.validation,
      { error: 'Failed to load asset whereabouts' },
      500
    );
  }
}
