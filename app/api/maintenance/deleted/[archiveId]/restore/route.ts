import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getProfileWithRole } from '@/lib/utils/permissions';
import { logServerError } from '@/lib/utils/server-error-logger';

// PUT - Restore an archived vehicle back to active status
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ archiveId: string }> }
) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is admin or manager
    const profile = await getProfileWithRole(user.id);

    if (!profile || !profile.role?.is_manager_admin) {
      return NextResponse.json(
        { error: 'Forbidden: Manager or Admin access required' },
        { status: 403 }
      );
    }

    const archiveId = (await params).archiveId;

    // Get the archived vehicle data
    const { data: archivedVehicle, error: fetchError } = await supabase
      .from('vehicle_archive')
      .select('*')
      .eq('id', archiveId)
      .single();

    if (fetchError || !archivedVehicle) {
      return NextResponse.json(
        { error: 'Archived vehicle not found' },
        { status: 404 }
      );
    }

    // Check if the vehicle still exists in the vehicles table
    const { data: existingVehicle } = await supabase
      .from('vehicles')
      .select('id, status')
      .eq('id', archivedVehicle.vehicle_id)
      .single();

    if (existingVehicle) {
      // Vehicle exists, just update its status back to active
      const { error: updateError } = await supabase
        .from('vehicles')
        .update({ 
          status: 'active'
        })
        .eq('id', archivedVehicle.vehicle_id);

      if (updateError) {
        console.error('Failed to restore vehicle status:', updateError);
        throw updateError;
      }
    } else {
      // Vehicle doesn't exist, recreate it from archived data
      const vehicleData = archivedVehicle.vehicle_data as any;
      
      const { error: insertError } = await supabase
        .from('vehicles')
        .insert({
          id: archivedVehicle.vehicle_id,
          reg_number: archivedVehicle.reg_number,
          category_id: archivedVehicle.category_id,
          status: 'active',
          nickname: vehicleData?.nickname || null,
          created_at: vehicleData?.created_at || new Date().toISOString(),
        });

      if (insertError) {
        console.error('Failed to recreate vehicle:', insertError);
        throw insertError;
      }

      // If there's maintenance data, restore it too
      if (archivedVehicle.maintenance_data) {
        const maintenanceData = Array.isArray(archivedVehicle.maintenance_data) 
          ? archivedVehicle.maintenance_data[0] 
          : archivedVehicle.maintenance_data;
        
        if (maintenanceData) {
          const { error: maintenanceError } = await supabase
            .from('vehicle_maintenance')
            .upsert({
              ...maintenanceData,
              vehicle_id: archivedVehicle.vehicle_id,
              updated_at: new Date().toISOString(),
            }, {
              onConflict: 'vehicle_id'
            });

          if (maintenanceError) {
            console.error('Failed to restore maintenance data:', maintenanceError);
            // Don't throw - vehicle is restored, maintenance can be re-entered
          }
        }
      }
    }

    // Optionally remove from archive or mark as restored
    const { error: deleteArchiveError } = await supabase
      .from('vehicle_archive')
      .delete()
      .eq('id', archiveId);

    if (deleteArchiveError) {
      console.error('Failed to remove from archive:', deleteArchiveError);
      // Don't throw - vehicle is restored, archive cleanup is optional
    }

    return NextResponse.json({ 
      success: true,
      message: `Vehicle ${archivedVehicle.reg_number} restored to active vehicles`
    });
  } catch (error) {
    console.error('Error restoring archived vehicle:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/maintenance/deleted/[archiveId]/restore',
      additionalData: {
        endpoint: '/api/maintenance/deleted/[archiveId]/restore',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
