import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { logServerError } from '@/lib/utils/server-error-logger';
import { validateRegistrationNumber, formatRegistrationForStorage } from '@/lib/utils/registration';

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

// PUT - Update van
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const effectiveRole = await getEffectiveRole();

    if (!effectiveRole.user_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!effectiveRole.is_manager_admin) {
      return NextResponse.json(
        { error: 'Forbidden: Manager or Admin access required' },
        { status: 403 }
      );
    }

    const supabase = await createServerClient();
    const vanId = (await params).id;
    const body = await request.json();
    const { reg_number, category_id, status, nickname } = body;

    const updates: any = {};
    
    if (reg_number !== undefined) {
      const validationError = validateRegistrationNumber(reg_number);
      if (validationError) {
        return NextResponse.json({ error: validationError }, { status: 400 });
      }
      updates.reg_number = formatRegistrationForStorage(reg_number);
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

    if ('reg_number' in updates || 'category_id' in updates) {
      const { data: currentVan } = await supabase
        .from('vans')
        .select('reg_number, category_id')
        .eq('id', vanId)
        .single();

      const finalRegNumber = updates.reg_number || currentVan?.reg_number;
      const finalCategoryId = updates.category_id || currentVan?.category_id;

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

    const { data, error } = await supabase
      .from('vans')
      .update(updates)
      .eq('id', vanId)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'Van with this registration already exists' },
          { status: 400 }
        );
      }
      throw error;
    }

    return NextResponse.json({ vehicle: data });
  } catch (error) {
    console.error('Error updating van:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/vans/[id]',
      additionalData: {
        endpoint: '/api/admin/vans/[id]',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE - Delete van (archive)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const effectiveRole = await getEffectiveRole();

    if (!effectiveRole.user_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!effectiveRole.is_manager_admin) {
      return NextResponse.json(
        { error: 'Forbidden: Manager or Admin access required' },
        { status: 403 }
      );
    }

    const supabase = await createServerClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const vanId = (await params).id;

    const body = await request.json().catch(() => ({}));
    const reason = body.reason || 'Other';

    // Check for open workshop tasks
    const adminSupabase = getSupabaseAdmin();
    const { data: openTasks, error: tasksError } = await adminSupabase
      .from('actions')
      .select('id, status, workshop_comments')
      .eq('van_id', vanId)
      .in('action_type', ['workshop_vehicle_task', 'inspection_defect'])
      .neq('status', 'completed')
      .limit(1);

    if (tasksError) {
      console.error('Error checking for open tasks:', tasksError);
      throw new Error('Failed to check for open workshop tasks');
    }

    if (openTasks && openTasks.length > 0) {
      return NextResponse.json(
        { error: 'Cannot retire van with open workshop tasks. Please complete or delete all open tasks first.' },
        { status: 400 }
      );
    }

    const { data: van } = await supabase
      .from('vans')
      .select('*, vehicle_maintenance(*)')
      .eq('id', vanId)
      .single();

    if (!van) {
      return NextResponse.json(
        { error: 'Van not found' },
        { status: 404 }
      );
    }

    // Archive the van
    const { error: archiveError } = await supabase.from('van_archive').insert({
      van_id: van.id,
      reg_number: van.reg_number,
      category_id: van.category_id,
      status: van.status,
      archive_reason: reason,
      archived_by: user.id,
      vehicle_data: van,
      maintenance_data: van.vehicle_maintenance || null,
    });

    if (archiveError) {
      console.error('Failed to archive van:', archiveError);
      throw new Error(`Failed to archive van: ${archiveError.message}`);
    }

    // Soft delete
    const { error: updateError } = await supabase
      .from('vans')
      .update({ status: 'archived' })
      .eq('id', vanId);

    if (updateError) throw updateError;

    return NextResponse.json({ 
      success: true,
      message: `Van archived (Reason: ${reason})`
    });
  } catch (error) {
    console.error('Error deleting van:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/vans/[id]',
      additionalData: {
        endpoint: '/api/admin/vans/[id]',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
