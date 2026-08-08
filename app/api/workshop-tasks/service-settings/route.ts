import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isEffectiveRoleManagerOrHigher } from '@/lib/utils/rbac';
import { logServerError } from '@/lib/utils/server-error-logger';
import {
  AssetServiceError,
  getServiceSettings,
  saveServiceSettings,
} from '@/lib/server/asset-service';
import type { ServiceAssetType, ServiceMeterUnit } from '@/lib/utils/assetServiceRotation';

function parseAssetType(value: string | null): ServiceAssetType | null {
  if (value === 'van' || value === 'hgv' || value === 'plant') return value;
  return null;
}

async function requireManager() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const canManage = await isEffectiveRoleManagerOrHigher();
  if (!canManage) {
    return { error: NextResponse.json({ error: 'Manager or admin required' }, { status: 403 }) };
  }

  return { user };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireManager();
    if ('error' in auth && auth.error) return auth.error;

    const assetType = parseAssetType(request.nextUrl.searchParams.get('assetType'));
    if (!assetType) {
      return NextResponse.json({ error: 'assetType must be van, hgv, or plant' }, { status: 400 });
    }

    const settings = await getServiceSettings(assetType);
    return NextResponse.json({ settings });
  } catch (error) {
    await logServerError({
      error: error instanceof Error ? error : new Error(String(error)),
      request,
      componentName: '/api/workshop-tasks/service-settings',
      additionalData: {
        endpoint: 'GET /api/workshop-tasks/service-settings',
      },
    });
    if (error instanceof AssetServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: 'Failed to load service settings' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await requireManager();
    if ('error' in auth && auth.error) return auth.error;

    const body = await request.json();
    const assetType = parseAssetType(body.assetType);
    if (!assetType) {
      return NextResponse.json({ error: 'assetType must be van, hgv, or plant' }, { status: 400 });
    }

    const intervalUnit = body.intervalUnit as ServiceMeterUnit;
    if (!['miles', 'km', 'hours'].includes(intervalUnit)) {
      return NextResponse.json({ error: 'Invalid interval unit' }, { status: 400 });
    }

    const settings = await saveServiceSettings({
      assetType,
      intervalValue: Number(body.intervalValue),
      intervalUnit,
      linkedTemplateIds: Array.isArray(body.linkedTemplateIds) ? body.linkedTemplateIds : [],
      compactLabels: body.compactLabels && typeof body.compactLabels === 'object' ? body.compactLabels : {},
      rotationTemplateIds: Array.isArray(body.rotationTemplateIds) ? body.rotationTemplateIds : [],
    });

    return NextResponse.json({ settings });
  } catch (error) {
    await logServerError({
      error: error instanceof Error ? error : new Error(String(error)),
      request,
      componentName: '/api/workshop-tasks/service-settings',
      additionalData: {
        endpoint: 'PUT /api/workshop-tasks/service-settings',
      },
    });
    if (error instanceof AssetServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: 'Failed to save service settings' }, { status: 500 });
  }
}
