import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canEffectiveRoleUseModuleLevel } from '@/lib/utils/rbac';
import { logServerError } from '@/lib/utils/server-error-logger';
import {
  AssetServiceError,
  getAssetServiceState,
  getServiceSettings,
} from '@/lib/server/asset-service';
import type { ServiceAssetType } from '@/lib/utils/assetServiceRotation';

function parseAssetType(value: string | null): ServiceAssetType | null {
  if (value === 'van' || value === 'hgv' || value === 'plant') return value;
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canRead =
      (await canEffectiveRoleUseModuleLevel('admin-vans', 3)) ||
      (await canEffectiveRoleUseModuleLevel('maintenance', 3)) ||
      (await canEffectiveRoleUseModuleLevel('workshop-tasks', 1));
    if (!canRead) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const assetType = parseAssetType(request.nextUrl.searchParams.get('assetType'));
    if (!assetType) {
      return NextResponse.json({ error: 'assetType must be van, hgv, or plant' }, { status: 400 });
    }

    const settings = await getServiceSettings(assetType);
    const assetId = request.nextUrl.searchParams.get('assetId');
    const assetState = assetId ? await getAssetServiceState(assetType, assetId) : null;
    return NextResponse.json({
      templates: settings.linkedTemplates.filter((template) => template.isActive),
      intervalValue: settings.intervalValue,
      intervalUnit: settings.intervalUnit,
      rotation: settings.rotation,
      showServiceTypeBadge: settings.linkedTemplates.filter((template) => template.isActive).length >= 2,
      currentNextServiceTemplateId: assetState?.nextServiceTemplateId ?? null,
      currentNextServiceRotationStepId: assetState?.nextServiceRotationStepId ?? null,
    });
  } catch (error) {
    await logServerError({
      error: error instanceof Error ? error : new Error(String(error)),
      request,
      componentName: '/api/fleet/service-types',
      additionalData: {
        endpoint: 'GET /api/fleet/service-types',
      },
    });
    if (error instanceof AssetServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: 'Failed to load service types' }, { status: 500 });
  }
}
