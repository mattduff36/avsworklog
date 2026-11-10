import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { InspectionAssetType } from '@/lib/inspections/meter-correction';
import { createAdminClient } from '@/lib/supabase/admin';
import { getInspectionRouteActorAccess } from '@/lib/server/inspection-route-access';
import { getVanInspectionsMaintenanceResponse } from '@/lib/server/van-inspections-maintenance';
import {
  cleanupInspectionStorage, deleteInspection, InspectionDeletionError, withInspectionDeletionDatabase,
} from '@/lib/server/inspection-deletion';
import { logServerError } from '@/lib/utils/server-error-logger';

export async function handleInspectionDeletion(
  request: NextRequest, params: Promise<{ id: string }>, assetType: InspectionAssetType,
) {
  try {
    const { access, errorResponse } = await getInspectionRouteActorAccess(assetType === 'van' ? 'inspections' : `${assetType}-inspections`);
    if (errorResponse || !access) return errorResponse ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!access.canDeleteInspections) return NextResponse.json({ error: 'Forbidden: inspection management access required' }, { status: 403 });
    if (assetType === 'van') {
      const maintenance = getVanInspectionsMaintenanceResponse();
      if (maintenance) return maintenance;
    }
    const id = z.string().uuid().safeParse((await params).id);
    if (!id.success) return NextResponse.json({ error: 'Invalid Daily Check ID' }, { status: 400 });
    const result = await withInspectionDeletionDatabase(async client => {
      const deleted = await deleteInspection(client, assetType, id.data, access.userId);
      if (deleted.storageCleanupPending) {
        try {
          deleted.storageCleanupPending = await cleanupInspectionStorage(client, assetType, id.data, createAdminClient().storage);
        } catch {
          // The deletion has committed. Its durable outbox remains retryable.
          deleted.warnings.push('Photo cleanup failed after deletion. Retry the deletion request to retry cleanup.');
        }
        if (deleted.storageCleanupPending) deleted.warnings.push('Photo cleanup is pending; the Daily Check has been deleted.');
      }
      return deleted;
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof InspectionDeletionError) return NextResponse.json({ error: error.message }, { status: error.status });
    await logServerError({
      error: new Error('Transactional Daily Check deletion failed'),
      request, componentName: `/api/${assetType}-inspections/[id]/delete`,
    });
    return NextResponse.json({ error: 'Daily Check deletion failed. No deletion was confirmed; refresh before retrying.' }, { status: 500 });
  }
}
