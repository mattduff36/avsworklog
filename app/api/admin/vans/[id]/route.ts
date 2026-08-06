import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { logServerError } from '@/lib/utils/server-error-logger';
import { validateRegistrationNumber, formatRegistrationForStorage } from '@/lib/utils/registration';
import { canEffectiveRoleUseModuleLevel } from '@/lib/utils/rbac';
import { createDVLAApiService } from '@/lib/services/dvla-api';
import { createMotHistoryService } from '@/lib/services/mot-history-api';
import { isRoadEligibleRegistration, runFleetDvlaSync } from '@/lib/services/fleet-dvla-sync';
import { applyNicknameAssignmentFromBody } from '@/lib/server/apply-fleet-nickname-assignment-from-body';

function normalizeRegistration(registrationNumber: string | null | undefined): string {
  return registrationNumber?.replace(/\s+/g, '').trim().toUpperCase() || '';
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

    // FLEET-TIERS: edit assets requires admin-vans Level 4+
    const canManageFleet = await canEffectiveRoleUseModuleLevel('admin-vans', 4);
    if (!canManageFleet) {
      return NextResponse.json(
        { error: 'Forbidden: Fleet Level 4 required' },
        { status: 403 }
      );
    }

    const supabase = createAdminClient();
    const vanId = (await params).id;
    const body = await request.json();
    const { reg_number, category_id, status, nickname } = body;
    const hasAssignmentIntent =
      body && typeof body === 'object' && 'assignment' in body && body.assignment != null;

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
    
    // Nickname without assignment intent updates here; assignment RPC owns nickname otherwise.
    if (nickname !== undefined && !hasAssignmentIntent) {
      updates.nickname = nickname?.trim() || null;
    }

    let currentVan: { reg_number: string | null; category_id: string | null } | null = null;

    if ('reg_number' in updates || 'category_id' in updates) {
      const { data: currentVanData, error: currentVanError } = await supabase
        .from('vans')
        .select('reg_number, category_id')
        .eq('id', vanId)
        .maybeSingle();

      if (currentVanError) throw currentVanError;

      if (!currentVanData) {
        return NextResponse.json(
          { error: 'Van not found' },
          { status: 404 }
        );
      }

      currentVan = currentVanData;

      const finalRegNumber = typeof updates.reg_number === 'string'
        ? updates.reg_number
        : currentVan.reg_number;
      const finalCategoryId = typeof updates.category_id === 'string'
        ? updates.category_id
        : currentVan.category_id;

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

    const previousRegNumber = currentVan?.reg_number || null;
    const nextRegNumber = typeof updates.reg_number === 'string'
      ? updates.reg_number
      : previousRegNumber;
    const hasRegistrationChanged = Boolean(
      previousRegNumber &&
      nextRegNumber &&
      normalizeRegistration(previousRegNumber) !== normalizeRegistration(nextRegNumber)
    );

    let data;
    if (Object.keys(updates).length === 0) {
      const { data: existingVan, error: existingError } = await supabase
        .from('vans')
        .select()
        .eq('id', vanId)
        .maybeSingle();
      if (existingError) throw existingError;
      data = existingVan;
    } else {
      const { data: updatedVan, error } = await supabase
        .from('vans')
        .update(updates)
        .eq('id', vanId)
        .select()
        .maybeSingle();

      if (error) {
        if (error.code === '23505') {
          return NextResponse.json(
            { error: 'Van with this registration already exists' },
            { status: 400 }
          );
        }
        throw error;
      }
      data = updatedVan;
    }

    if (!data) {
      return NextResponse.json(
        { error: 'Van not found' },
        { status: 404 }
      );
    }

    const assignmentUpdate = await applyNicknameAssignmentFromBody({
      admin: supabase,
      body,
      assetType: 'van',
      assetId: vanId,
      actorUserId: effectiveRole.user_id,
      fallbackNickname: typeof nickname === 'string' ? nickname : nickname ?? null,
    });
    if (assignmentUpdate.error) {
      return NextResponse.json(
        { error: assignmentUpdate.error },
        { status: assignmentUpdate.status || 400 }
      );
    }
    if (assignmentUpdate.applied) {
      const { data: refreshedVan, error: refreshError } = await supabase
        .from('vans')
        .select()
        .eq('id', vanId)
        .maybeSingle();
      if (refreshError) throw refreshError;
      if (refreshedVan) data = refreshedVan;
    }

    let syncResult: unknown = null;
    if (hasRegistrationChanged && data.reg_number && isRoadEligibleRegistration(data.reg_number)) {
      try {
        const dvlaService = createDVLAApiService();
        if (dvlaService) {
          syncResult = await runFleetDvlaSync({
            supabase,
            dvlaService,
            motService: createMotHistoryService(),
            targets: [
              {
                assetType: 'van',
                assetId: vanId,
                registrationNumber: data.reg_number,
              },
            ],
            triggerType: 'manual',
            triggeredBy: effectiveRole.user_id,
            logPrefix: '[VRN CHANGE] ',
          });
        } else {
          syncResult = {
            total: 1,
            successful: 0,
            failed: 1,
            warning: 'DVLA API not configured; registration updated but DVLA/MOT refresh did not run',
            results: [],
          };
        }
      } catch (syncError) {
        console.error('Error syncing van after VRN change:', syncError);
        syncResult = {
          total: 1,
          successful: 0,
          failed: 1,
          warning: syncError instanceof Error
            ? syncError.message
            : 'Registration updated but DVLA/MOT refresh failed',
          results: [],
        };
      }
    }

    return NextResponse.json({
      vehicle: data,
      syncResult,
      assignment: assignmentUpdate.result || null,
    });
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

    // FLEET-TIERS: retire/archive assets requires admin-vans Level 4+
    const canManageFleet = await canEffectiveRoleUseModuleLevel('admin-vans', 4);
    if (!canManageFleet) {
      return NextResponse.json(
        { error: 'Forbidden: Fleet Level 4 required' },
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
    const adminSupabase = createAdminClient();
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
