import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { logServerError } from '@/lib/utils/server-error-logger';
import { validateAndNormalizePlantSerialNumber } from '@/lib/utils/plant-serial-number';
import { applyNicknameAssignmentFromBody } from '@/lib/server/apply-fleet-nickname-assignment-from-body';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const effectiveRole = await getEffectiveRole();
    if (!effectiveRole.user_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canManageFleet = await canEffectiveRoleAccessModule('admin-vans');
    if (!canManageFleet) {
      return NextResponse.json({ error: 'Forbidden: Fleet admin access required' }, { status: 403 });
    }

    const plantId = (await params).id;
    const body = await request.json();
    const admin = createAdminClient();
    const hasAssignmentIntent =
      body && typeof body === 'object' && 'assignment' in body && body.assignment != null;

    const updates: Record<string, unknown> = {};
    if (body.nickname !== undefined && !hasAssignmentIntent) {
      updates.nickname = typeof body.nickname === 'string' ? body.nickname.trim() || null : null;
    }
    if (body.category_id !== undefined) updates.category_id = body.category_id;
    if (body.reg_number !== undefined) {
      updates.reg_number = typeof body.reg_number === 'string' ? body.reg_number.trim() || null : null;
    }
    if (body.serial_number !== undefined) {
      const serialNumberResult = validateAndNormalizePlantSerialNumber(body.serial_number);
      if (!serialNumberResult.valid) {
        return NextResponse.json(
          { error: serialNumberResult.error || 'Serial Number is invalid' },
          { status: 400 }
        );
      }
      updates.serial_number = serialNumberResult.value;
    }
    if (body.status !== undefined) updates.status = body.status;
    if (body.year !== undefined) updates.year = typeof body.year === 'number' ? body.year : null;
    if (body.weight_class !== undefined) {
      updates.weight_class = typeof body.weight_class === 'string' ? body.weight_class.trim() || null : null;
    }

    let data;
    if (Object.keys(updates).length === 0) {
      const { data: existing, error } = await admin.from('plant').select().eq('id', plantId).maybeSingle();
      if (error) throw error;
      data = existing;
    } else {
      const { data: updated, error } = await admin
        .from('plant')
        .update(updates)
        .eq('id', plantId)
        .select()
        .maybeSingle();
      if (error) {
        if (error.code === '23505') {
          return NextResponse.json({ error: 'Plant update conflicts with an existing record' }, { status: 400 });
        }
        throw error;
      }
      data = updated;
    }

    if (!data) {
      return NextResponse.json({ error: 'Plant not found' }, { status: 404 });
    }

    const assignmentUpdate = await applyNicknameAssignmentFromBody({
      admin,
      body,
      assetType: 'plant',
      assetId: plantId,
      actorUserId: effectiveRole.user_id,
      fallbackNickname: typeof body.nickname === 'string' ? body.nickname : body.nickname ?? null,
    });
    if (assignmentUpdate.error) {
      return NextResponse.json(
        { error: assignmentUpdate.error },
        { status: assignmentUpdate.status || 400 }
      );
    }
    if (assignmentUpdate.applied) {
      const { data: refreshed, error: refreshError } = await admin
        .from('plant')
        .select()
        .eq('id', plantId)
        .maybeSingle();
      if (refreshError) throw refreshError;
      if (refreshed) data = refreshed;
    }

    return NextResponse.json({ plant: data, assignment: assignmentUpdate.result || null });
  } catch (error) {
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/plant/[id]',
      additionalData: { endpoint: '/api/admin/plant/[id]' },
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const effectiveRole = await getEffectiveRole();
    if (!effectiveRole.user_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canManageFleet = await canEffectiveRoleAccessModule('admin-vans');
    if (!canManageFleet) {
      return NextResponse.json({ error: 'Forbidden: Fleet admin access required' }, { status: 403 });
    }

    const plantId = (await params).id;
    const body = await request.json().catch(() => ({}));
    const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : 'Other';
    const admin = createAdminClient();

    const { data: openTasks, error: tasksError } = await admin
      .from('actions')
      .select('id')
      .eq('plant_id', plantId)
      .in('action_type', ['workshop_vehicle_task', 'inspection_defect'])
      .neq('status', 'completed')
      .limit(1);

    if (tasksError) throw tasksError;
    if (openTasks && openTasks.length > 0) {
      return NextResponse.json(
        { error: 'Cannot retire plant with open workshop tasks. Please complete or delete all open tasks first.' },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const { data, error } = await admin
      .from('plant')
      .update({
        status: 'retired',
        retired_at: now,
        retire_reason: reason,
      })
      .eq('id', plantId)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: 'Plant not found' }, { status: 404 });
    }

    // Trigger clears fleet assignment on status change; no extra call required.
    return NextResponse.json({
      success: true,
      plant: data,
      message: `Plant retired (Reason: ${reason})`,
    });
  } catch (error) {
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/plant/[id]',
      additionalData: { endpoint: '/api/admin/plant/[id] DELETE' },
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
