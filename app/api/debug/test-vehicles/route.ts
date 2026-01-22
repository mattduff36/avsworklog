import { NextRequest, NextResponse } from 'next/server';
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

/**
 * GET /api/debug/test-vehicles
 * List vehicles matching a prefix (for test vehicle management)
 * SuperAdmin only
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check SuperAdmin access
    const profile = await getProfileWithRole(user.id);
    const isSuperAdmin = user.email === 'admin@mpdee.co.uk' || profile?.role?.is_super_admin === true;

    if (!isSuperAdmin) {
      return NextResponse.json(
        { error: 'Forbidden: SuperAdmin access required' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const prefix = searchParams.get('prefix') || 'TE57';

    // Fetch vehicles matching prefix
    const adminSupabase = getSupabaseAdmin();
    const { data: vehicles, error } = await adminSupabase
      .from('vehicles')
      .select('id, reg_number, nickname, status')
      .ilike('reg_number', `${prefix}%`)
      .order('reg_number');

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      vehicles: vehicles || [],
      prefix,
    });
  } catch (error) {
    console.error('Error fetching test vehicles:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/debug/test-vehicles',
      additionalData: {
        endpoint: 'GET /api/debug/test-vehicles',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/debug/test-vehicles
 * Preview or execute purge operations on test vehicles
 * SuperAdmin only
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check SuperAdmin access
    const profile = await getProfileWithRole(user.id);
    const isSuperAdmin = user.email === 'admin@mpdee.co.uk' || profile?.role?.is_super_admin === true;

    if (!isSuperAdmin) {
      return NextResponse.json(
        { error: 'Forbidden: SuperAdmin access required' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const {
      mode,
      vehicle_ids,
      prefix,
      actions,
    } = body;

    // Validate required fields
    if (!mode || !['preview', 'execute'].includes(mode)) {
      return NextResponse.json(
        { error: 'Invalid mode. Must be "preview" or "execute"' },
        { status: 400 }
      );
    }

    if (!vehicle_ids || !Array.isArray(vehicle_ids) || vehicle_ids.length === 0) {
      return NextResponse.json(
        { error: 'vehicle_ids is required and must be a non-empty array' },
        { status: 400 }
      );
    }

    const validPrefix = prefix || 'TE57';

    // Use admin client for all operations
    const adminSupabase = getSupabaseAdmin();

    // SECURITY: Verify all selected vehicles match the prefix
    const { data: vehiclesToProcess, error: vehicleError } = await adminSupabase
      .from('vehicles')
      .select('id, reg_number')
      .in('id', vehicle_ids);

    if (vehicleError) {
      throw vehicleError;
    }

    if (!vehiclesToProcess || vehiclesToProcess.length === 0) {
      return NextResponse.json(
        { error: 'No vehicles found with provided IDs' },
        { status: 404 }
      );
    }

    // CRITICAL SECURITY CHECK: Verify ALL vehicles match the prefix
    const invalidVehicles = vehiclesToProcess.filter(
      v => !v.reg_number.toUpperCase().startsWith(validPrefix.toUpperCase())
    );

    if (invalidVehicles.length > 0) {
      return NextResponse.json(
        {
          error: `Security violation: Cannot process vehicles that don't match prefix "${validPrefix}"`,
          invalid_vehicles: invalidVehicles.map(v => v.reg_number),
        },
        { status: 403 }
      );
    }

    const vehicleIds = vehiclesToProcess.map(v => v.id);

    // Build counts object
    const counts: Record<string, number> = {};

    // Count/delete inspections
    if (actions?.inspections) {
      const { count: inspectionCount } = await adminSupabase
        .from('vehicle_inspections')
        .select('id', { count: 'exact', head: true })
        .in('vehicle_id', vehicleIds);

      counts.inspections = inspectionCount || 0;

      if (mode === 'execute' && counts.inspections > 0) {
        const { error: deleteError } = await adminSupabase
          .from('vehicle_inspections')
          .delete()
          .in('vehicle_id', vehicleIds);

        if (deleteError) {
          throw deleteError;
        }
      }
    }

    // Count/delete workshop tasks (actions table)
    if (actions?.workshop_tasks) {
      const { count: taskCount } = await adminSupabase
        .from('actions')
        .select('id', { count: 'exact', head: true })
        .in('vehicle_id', vehicleIds)
        .in('action_type', ['inspection_defect', 'workshop_vehicle_task']);

      counts.workshop_tasks = taskCount || 0;

      if (mode === 'execute' && counts.workshop_tasks > 0) {
        const { error: deleteError } = await adminSupabase
          .from('actions')
          .delete()
          .in('vehicle_id', vehicleIds)
          .in('action_type', ['inspection_defect', 'workshop_vehicle_task']);

        if (deleteError) {
          throw deleteError;
        }
      }
    }

    // Count/delete maintenance records
    if (actions?.maintenance) {
      const { count: maintenanceCount } = await adminSupabase
        .from('vehicle_maintenance')
        .select('id', { count: 'exact', head: true })
        .in('vehicle_id', vehicleIds);

      counts.maintenance_records = maintenanceCount || 0;

      const { count: historyCount } = await adminSupabase
        .from('maintenance_history')
        .select('id', { count: 'exact', head: true })
        .in('vehicle_id', vehicleIds);

      counts.maintenance_history = historyCount || 0;

      if (mode === 'execute') {
        // Delete maintenance history first (references maintenance)
        if (counts.maintenance_history > 0) {
          const { error: historyError } = await adminSupabase
            .from('maintenance_history')
            .delete()
            .in('vehicle_id', vehicleIds);

          if (historyError) {
            throw historyError;
          }
        }

        // Delete maintenance records
        if (counts.maintenance_records > 0) {
          const { error: maintenanceError } = await adminSupabase
            .from('vehicle_maintenance')
            .delete()
            .in('vehicle_id', vehicleIds);

          if (maintenanceError) {
            throw maintenanceError;
          }
        }
      }
    }

    // Count/delete DVLA sync logs
    if (actions?.maintenance) {
      const { count: dvlaCount } = await adminSupabase
        .from('dvla_sync_log')
        .select('id', { count: 'exact', head: true })
        .in('vehicle_id', vehicleIds);

      counts.dvla_sync_logs = dvlaCount || 0;

      if (mode === 'execute' && counts.dvla_sync_logs > 0) {
        const { error: dvlaError } = await adminSupabase
          .from('dvla_sync_log')
          .delete()
          .in('vehicle_id', vehicleIds);

        if (dvlaError) {
          throw dvlaError;
        }
      }
    }

    // Count/delete MOT history records
    if (actions?.maintenance) {
      const { count: motCount } = await adminSupabase
        .from('mot_test_history')
        .select('id', { count: 'exact', head: true })
        .in('vehicle_id', vehicleIds);

      counts.mot_test_history = motCount || 0;

      if (mode === 'execute' && counts.mot_test_history > 0) {
        // MOT defects and comments should cascade via ON DELETE CASCADE
        const { error: motError } = await adminSupabase
          .from('mot_test_history')
          .delete()
          .in('vehicle_id', vehicleIds);

        if (motError) {
          throw motError;
        }
      }
    }

    // Count/delete vehicle archives
    if (actions?.archives) {
      // Get reg numbers for archive lookup
      const regNumbers = vehiclesToProcess.map(v => v.reg_number);

      const { count: archiveCount } = await adminSupabase
        .from('vehicle_archive')
        .select('id', { count: 'exact', head: true })
        .in('reg_number', regNumbers);

      counts.vehicle_archives = archiveCount || 0;

      if (mode === 'execute' && counts.vehicle_archives > 0) {
        const { error: archiveError } = await adminSupabase
          .from('vehicle_archive')
          .delete()
          .in('reg_number', regNumbers);

        if (archiveError) {
          throw archiveError;
        }
      }
    }

    // Return preview or execution results
    if (mode === 'preview') {
      return NextResponse.json({
        success: true,
        mode: 'preview',
        counts,
        vehicles: vehiclesToProcess.length,
      });
    } else {
      return NextResponse.json({
        success: true,
        mode: 'execute',
        deleted_counts: counts,
        affected_vehicles: vehiclesToProcess.length,
        vehicle_ids: vehicleIds,
      });
    }
  } catch (error) {
    console.error('Error in test vehicles purge:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/debug/test-vehicles',
      additionalData: {
        endpoint: 'POST /api/debug/test-vehicles',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/debug/test-vehicles
 * Archive or hard delete vehicle records
 * SuperAdmin only
 */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check SuperAdmin access
    const profile = await getProfileWithRole(user.id);
    const isSuperAdmin = user.email === 'admin@mpdee.co.uk' || profile?.role?.is_super_admin === true;

    if (!isSuperAdmin) {
      return NextResponse.json(
        { error: 'Forbidden: SuperAdmin access required' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const {
      vehicle_ids,
      prefix,
      mode, // 'archive' or 'hard_delete'
      archive_reason,
    } = body;

    // Validate required fields
    if (!vehicle_ids || !Array.isArray(vehicle_ids) || vehicle_ids.length === 0) {
      return NextResponse.json(
        { error: 'vehicle_ids is required and must be a non-empty array' },
        { status: 400 }
      );
    }

    if (!mode || !['archive', 'hard_delete'].includes(mode)) {
      return NextResponse.json(
        { error: 'Invalid mode. Must be "archive" or "hard_delete"' },
        { status: 400 }
      );
    }

    const validPrefix = prefix || 'TE57';
    const adminSupabase = getSupabaseAdmin();

    // SECURITY: Verify all selected vehicles match the prefix
    const { data: vehiclesToProcess, error: vehicleError } = await adminSupabase
      .from('vehicles')
      .select('id, reg_number, category_id, status')
      .in('id', vehicle_ids);

    if (vehicleError) {
      throw vehicleError;
    }

    if (!vehiclesToProcess || vehiclesToProcess.length === 0) {
      return NextResponse.json(
        { error: 'No vehicles found with provided IDs' },
        { status: 404 }
      );
    }

    // CRITICAL SECURITY CHECK: Verify ALL vehicles match the prefix
    const invalidVehicles = vehiclesToProcess.filter(
      v => !v.reg_number.toUpperCase().startsWith(validPrefix.toUpperCase())
    );

    if (invalidVehicles.length > 0) {
      return NextResponse.json(
        {
          error: `Security violation: Cannot delete vehicles that don't match prefix "${validPrefix}"`,
          invalid_vehicles: invalidVehicles.map(v => v.reg_number),
        },
        { status: 403 }
      );
    }

    if (mode === 'archive') {
      // Use existing archive pattern (soft delete)
      let archivedCount = 0;

      for (const vehicle of vehiclesToProcess) {
        // Get full vehicle data for archiving
        const { data: fullVehicle } = await adminSupabase
          .from('vehicles')
          .select('*, vehicle_maintenance(*)')
          .eq('id', vehicle.id)
          .single();

        if (fullVehicle) {
          // Archive the vehicle
          const { error: archiveError } = await adminSupabase
            .from('vehicle_archive')
            .insert({
              vehicle_id: fullVehicle.id,
              reg_number: fullVehicle.reg_number,
              category_id: fullVehicle.category_id,
              status: fullVehicle.status,
              archive_reason: archive_reason || 'Test Data Cleanup',
              archived_by: user.id,
              vehicle_data: fullVehicle,
              maintenance_data: fullVehicle.vehicle_maintenance || null,
            });

          if (archiveError) {
            console.error('Failed to archive vehicle:', archiveError);
            continue; // Skip to next vehicle
          }

          // Mark vehicle as archived
          const { error: updateError } = await adminSupabase
            .from('vehicles')
            .update({ status: 'archived' })
            .eq('id', vehicle.id);

          if (!updateError) {
            archivedCount++;
          }
        }
      }

      return NextResponse.json({
        success: true,
        mode: 'archive',
        archived_count: archivedCount,
        total_requested: vehiclesToProcess.length,
      });
    } else {
      // Hard delete mode
      const vehicleIds = vehiclesToProcess.map(v => v.id);

      // Delete in proper order to avoid FK violations
      const deleteCounts: Record<string, number> = {};

      // First, get all task IDs for these vehicles
      const { data: tasksToDelete } = await adminSupabase
        .from('actions')
        .select('id')
        .in('vehicle_id', vehicleIds)
        .in('action_type', ['inspection_defect', 'workshop_vehicle_task']);

      const taskIds = tasksToDelete?.map(t => t.id) || [];

      // 1. Delete workshop task comments (references actions)
      if (taskIds.length > 0) {
        const { count: commentsCount } = await adminSupabase
          .from('workshop_task_comments')
          .select('id', { count: 'exact', head: true })
          .in('task_id', taskIds);

        deleteCounts.workshop_task_comments = commentsCount || 0;

        if (deleteCounts.workshop_task_comments > 0) {
          await adminSupabase
            .from('workshop_task_comments')
            .delete()
            .in('task_id', taskIds);
        }
      } else {
        deleteCounts.workshop_task_comments = 0;
      }

      // 2. Delete workshop task attachments (and responses will cascade)
      if (taskIds.length > 0) {
        const { data: taskAttachments } = await adminSupabase
          .from('workshop_task_attachments')
          .select('id, task_id')
          .in('task_id', taskIds);

        deleteCounts.workshop_attachments = taskAttachments?.length || 0;

        if (taskAttachments && taskAttachments.length > 0) {
          const attachmentIds = taskAttachments.map(a => a.id);

          // Delete responses first (references attachments)
          await adminSupabase
            .from('workshop_attachment_responses')
            .delete()
            .in('attachment_id', attachmentIds);

          // Delete attachments
          await adminSupabase
            .from('workshop_task_attachments')
            .delete()
            .in('id', attachmentIds);
        }
      } else {
        deleteCounts.workshop_attachments = 0;
      }

      // 3. Delete actions (workshop tasks)
      deleteCounts.workshop_tasks = taskIds.length;

      if (taskIds.length > 0) {
        await adminSupabase
          .from('actions')
          .delete()
          .in('id', taskIds);
      }

      // 4. Delete inspections (and dependent rows will cascade)
      const { count: inspectionsCount } = await adminSupabase
        .from('vehicle_inspections')
        .select('id', { count: 'exact', head: true })
        .in('vehicle_id', vehicleIds);

      deleteCounts.inspections = inspectionsCount || 0;

      if (deleteCounts.inspections > 0) {
        await adminSupabase
          .from('vehicle_inspections')
          .delete()
          .in('vehicle_id', vehicleIds);
      }

      // 5. Delete maintenance history
      const { count: historyCount } = await adminSupabase
        .from('maintenance_history')
        .select('id', { count: 'exact', head: true })
        .in('vehicle_id', vehicleIds);

      deleteCounts.maintenance_history = historyCount || 0;

      if (deleteCounts.maintenance_history > 0) {
        await adminSupabase
          .from('maintenance_history')
          .delete()
          .in('vehicle_id', vehicleIds);
      }

      // 6. Delete DVLA sync logs
      const { count: dvlaCount } = await adminSupabase
        .from('dvla_sync_log')
        .select('id', { count: 'exact', head: true })
        .in('vehicle_id', vehicleIds);

      deleteCounts.dvla_sync_logs = dvlaCount || 0;

      if (deleteCounts.dvla_sync_logs > 0) {
        await adminSupabase
          .from('dvla_sync_log')
          .delete()
          .in('vehicle_id', vehicleIds);
      }

      // 7. Delete MOT test history (defects/comments cascade)
      const { count: motCount } = await adminSupabase
        .from('mot_test_history')
        .select('id', { count: 'exact', head: true })
        .in('vehicle_id', vehicleIds);

      deleteCounts.mot_test_history = motCount || 0;

      if (deleteCounts.mot_test_history > 0) {
        await adminSupabase
          .from('mot_test_history')
          .delete()
          .in('vehicle_id', vehicleIds);
      }

      // 8. Delete vehicle maintenance
      const { count: maintenanceRecordCount } = await adminSupabase
        .from('vehicle_maintenance')
        .select('id', { count: 'exact', head: true })
        .in('vehicle_id', vehicleIds);

      deleteCounts.vehicle_maintenance = maintenanceRecordCount || 0;

      if (deleteCounts.vehicle_maintenance > 0) {
        await adminSupabase
          .from('vehicle_maintenance')
          .delete()
          .in('vehicle_id', vehicleIds);
      }

      // 9. Delete vehicle archives
      const regNumbers = vehiclesToProcess.map(v => v.reg_number);
      const { count: archiveCount } = await adminSupabase
        .from('vehicle_archive')
        .select('id', { count: 'exact', head: true })
        .in('reg_number', regNumbers);

      deleteCounts.vehicle_archives = archiveCount || 0;

      if (deleteCounts.vehicle_archives > 0) {
        await adminSupabase
          .from('vehicle_archive')
          .delete()
          .in('reg_number', regNumbers);
      }

      // 10. Finally, delete the vehicles themselves
      const { error: vehicleDeleteError } = await adminSupabase
        .from('vehicles')
        .delete()
        .in('id', vehicleIds);

      if (vehicleDeleteError) {
        throw vehicleDeleteError;
      }

      deleteCounts.vehicles = vehicleIds.length;

      return NextResponse.json({
        success: true,
        mode: 'hard_delete',
        deleted_counts: deleteCounts,
        affected_vehicles: vehicleIds.length,
      });
    }
  } catch (error) {
    console.error('Error deleting test vehicles:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/debug/test-vehicles',
      additionalData: {
        endpoint: 'DELETE /api/debug/test-vehicles',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
