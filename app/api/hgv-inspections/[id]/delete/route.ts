import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getInspectionRouteActorAccess } from '@/lib/server/inspection-route-access';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { access, errorResponse } = await getInspectionRouteActorAccess('hgv-inspections');
    if (errorResponse || !access) {
      return errorResponse ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!access.canManageOthers) {
      return NextResponse.json(
        { error: 'Forbidden: HGV inspection management access required' },
        { status: 403 }
      );
    }

    const inspectionId = (await params).id;
    const admin = createAdminClient();
    const { data: inspectionToDelete, error: lookupError } = await admin
      .from('hgv_inspections')
      .select('id, hgv_id')
      .eq('id', inspectionId)
      .single();

    if (lookupError || !inspectionToDelete) {
      return NextResponse.json(
        { error: 'HGV inspection not found' },
        { status: 404 }
      );
    }

    const { error: deleteError } = await admin
      .from('hgv_inspections')
      .delete()
      .eq('id', inspectionId);

    if (deleteError) {
      return NextResponse.json(
        { error: 'Failed to delete hgv inspection' },
        { status: 500 }
      );
    }

    const hgvId = inspectionToDelete.hgv_id;
    if (hgvId) {
      try {
        const { data: latestInspection, error: latestInspectionError } = await admin
          .from('hgv_inspections')
          .select('current_mileage')
          .eq('hgv_id', hgvId)
          .order('inspection_date', { ascending: false })
          .order('submitted_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (latestInspectionError) {
          throw latestInspectionError;
        }

        const latestMileage = latestInspection?.current_mileage ?? null;

        const { error: updateHgvError } = await admin
          .from('hgvs')
          .update({ current_mileage: latestMileage })
          .eq('id', hgvId);

        if (updateHgvError) {
          throw updateHgvError;
        }

        const { data: maintenanceRecord, error: maintenanceLookupError } = await admin
          .from('vehicle_maintenance')
          .select('id')
          .eq('hgv_id', hgvId)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (maintenanceLookupError) {
          throw maintenanceLookupError;
        }

        if (maintenanceRecord?.id) {
          const { error: updateMaintenanceError } = await admin
            .from('vehicle_maintenance')
            .update({
              current_mileage: latestMileage,
              last_mileage_update: new Date().toISOString(),
            })
            .eq('id', maintenanceRecord.id);

          if (updateMaintenanceError) {
            throw updateMaintenanceError;
          }
        } else if (latestMileage !== null) {
          const { error: insertMaintenanceError } = await admin
            .from('vehicle_maintenance')
            .insert({
              hgv_id: hgvId,
              current_mileage: latestMileage,
              last_mileage_update: new Date().toISOString(),
            });

          if (insertMaintenanceError) {
            throw insertMaintenanceError;
          }
        }
      } catch (syncError) {
        console.error('Failed to reconcile HGV mileage after inspection deletion', syncError);
      }
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
