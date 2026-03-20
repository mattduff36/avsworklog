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

// PUT - Update an HGV
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
    const hgvId = (await params).id;
    const body = await request.json();
    const { reg_number, category_id, status, nickname } = body;

    const updates: Record<string, unknown> = {};

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
      const { data: currentHgv } = await supabase
        .from('hgvs')
        .select('reg_number, category_id')
        .eq('id', hgvId)
        .single();

      const finalRegNumber = updates.reg_number || currentHgv?.reg_number;
      const finalCategoryId = updates.category_id || currentHgv?.category_id;

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
      .from('hgvs')
      .update(updates)
      .eq('id', hgvId)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'HGV with this registration already exists' },
          { status: 400 }
        );
      }
      throw error;
    }

    return NextResponse.json({ hgv: data });
  } catch (error) {
    console.error('Error updating HGV:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/hgvs/[id]',
      additionalData: {
        endpoint: '/api/admin/hgvs/[id]',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE - Retire an HGV (soft-delete with reason tracking)
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
    const hgvId = (await params).id;

    const body = await request.json().catch(() => ({}));
    const reason = body.reason || 'Other';

    const adminSupabase = getSupabaseAdmin();
    const { data: openTasks, error: tasksError } = await adminSupabase
      .from('actions')
      .select('id, status, workshop_comments')
      .eq('hgv_id', hgvId)
      .in('action_type', ['workshop_vehicle_task', 'inspection_defect'])
      .neq('status', 'completed')
      .limit(1);

    if (tasksError) {
      console.error('Error checking for open tasks:', tasksError);
      throw new Error('Failed to check for open workshop tasks');
    }

    if (openTasks && openTasks.length > 0) {
      return NextResponse.json(
        { error: 'Cannot retire HGV with open workshop tasks. Please complete or delete all open tasks first.' },
        { status: 400 }
      );
    }

    const { data: hgv } = await supabase
      .from('hgvs')
      .select('id, reg_number')
      .eq('id', hgvId)
      .single();

    if (!hgv) {
      return NextResponse.json(
        { error: 'HGV not found' },
        { status: 404 }
      );
    }

    const now = new Date().toISOString();
    const { error: updateError } = await supabase
      .from('hgvs')
      .update({
        status: 'retired',
        retired_at: now,
        retire_reason: reason,
      })
      .eq('id', hgvId);

    if (updateError) throw updateError;

    return NextResponse.json({
      success: true,
      message: `HGV ${hgv.reg_number} retired (Reason: ${reason})`,
    });
  } catch (error) {
    console.error('Error retiring HGV:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/hgvs/[id]',
      additionalData: {
        endpoint: '/api/admin/hgvs/[id]',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
