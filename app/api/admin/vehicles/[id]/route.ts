import { NextRequest, NextResponse} from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getProfileWithRole } from '@/lib/utils/permissions';
import { logServerError } from '@/lib/utils/server-error-logger';

// Helper to create admin client with service role key
function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

// PUT - Update vehicle
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is admin
    const profile = await getProfileWithRole(user.id);

    if (!profile || profile.role?.name !== 'admin') {
      return NextResponse.json(
        { error: 'Forbidden: Admin access required' },
        { status: 403 }
      );
    }

    const vehicleId = (await params).id;
    const body = await request.json();
    const { reg_number, category_id, status, nickname } = body;

    // Build update object with only provided fields
    const updates: any = {};
    
    if (reg_number !== undefined) {
      updates.reg_number = reg_number.toUpperCase();
    }
    
    if (category_id !== undefined) {
      updates.category_id = category_id;
    }
    
    if (status !== undefined) {
      updates.status = status;
    }
    
    if (nickname !== undefined) {
      updates.nickname = nickname?.trim() || null;
    }

    // If full update (reg_number and category_id provided), validate
    if ('reg_number' in updates || 'category_id' in updates) {
      // Get current vehicle to validate required fields
      const { data: currentVehicle } = await supabase
        .from('vehicles')
        .select('reg_number, category_id')
        .eq('id', vehicleId)
        .single();

      const finalRegNumber = updates.reg_number || currentVehicle?.reg_number;
      const finalCategoryId = updates.category_id || currentVehicle?.category_id;

      if (!finalRegNumber) {
        return NextResponse.json(
          { error: 'Registration number is required' },
          { status: 400 }
        );
      }

      if (!finalCategoryId) {
        return NextResponse.json(
          { error: 'Category is required' },
          { status: 400 }
        );
      }
    }

    // Update vehicle (vehicle_type will auto-sync from category via trigger)
    const { data, error } = await supabase
      .from('vehicles')
      .update(updates)
      .eq('id', vehicleId)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'Vehicle with this registration already exists' },
          { status: 400 }
        );
      }
      throw error;
    }

    return NextResponse.json({ vehicle: data });
  } catch (error) {
    console.error('Error updating vehicle:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/vehicles/[id]',
      additionalData: {
        endpoint: '/api/admin/vehicles/[id]',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE - Delete vehicle
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is admin
    const profile = await getProfileWithRole(user.id);

    if (!profile || profile.role?.name !== 'admin') {
      return NextResponse.json(
        { error: 'Forbidden: Admin access required' },
        { status: 403 }
      );
    }

    const vehicleId = (await params).id;

    // Parse request body to get reason
    const body = await request.json().catch(() => ({}));
    const reason = body.reason || 'Other';

    // Check if vehicle has any inspections
    const { data: inspections } = await supabase
      .from('vehicle_inspections')
      .select('id')
      .eq('vehicle_id', vehicleId)
      .limit(1);

    if (inspections && inspections.length > 0) {
      return NextResponse.json(
        {
          error:
            'Cannot delete vehicle with existing inspections. Set status to inactive instead.',
        },
        { status: 400 }
      );
    }

    // Get vehicle details before deleting (for archiving)
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('*, vehicle_maintenance(*)')
      .eq('id', vehicleId)
      .single();

    if (vehicle) {
      // Archive the vehicle with reason
      await supabase.from('vehicle_archive').insert({
        vehicle_id: vehicle.id,
        reg_number: vehicle.reg_number,
        category_id: vehicle.category_id,
        status: vehicle.status,
        archive_reason: reason,
        archived_by: user.id,
        vehicle_data: vehicle,
        maintenance_data: vehicle.vehicle_maintenance || null,
      }).catch((err) => {
        // Log error but don't fail delete if archiving fails
        console.error('Failed to archive vehicle:', err);
      });
    }

    // Delete vehicle (CASCADE will handle maintenance records)
    const { error } = await supabase
      .from('vehicles')
      .delete()
      .eq('id', vehicleId);

    if (error) throw error;

    return NextResponse.json({ 
      success: true,
      message: `Vehicle deleted (Reason: ${reason})`
    });
  } catch (error) {
    console.error('Error deleting vehicle:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/vehicles/[id]',
      additionalData: {
        endpoint: '/api/admin/vehicles/[id]',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

