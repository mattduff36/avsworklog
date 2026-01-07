import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/utils/logger';
import type { MaintenanceHistoryResponse } from '@/types/maintenance';

// Helper to create service role client for bypassing RLS
function getSupabaseServiceRole() {
  return createSupabaseClient(
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
 * GET /api/maintenance/history/[vehicleId]
 * Returns maintenance history for a vehicle
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ vehicleId: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Await params (Next.js 15 requirement)
    const { vehicleId } = await params;
    
    // Get vehicle info
    const { data: vehicle, error: vehicleError } = await supabase
      .from('vehicles')
      .select('id, reg_number')
      .eq('id', vehicleId)
      .single();
    
    if (vehicleError || !vehicle) {
      return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 });
    }
    
    // Get maintenance record with VES and MOT data
    const { data: maintenanceData } = await supabase
      .from('vehicle_maintenance')
      .select(`
        ves_make,
        ves_colour,
        ves_fuel_type,
        ves_year_of_manufacture,
        ves_engine_capacity,
        ves_tax_status,
        ves_mot_status,
        ves_co2_emissions,
        ves_euro_status,
        ves_real_driving_emissions,
        ves_type_approval,
        ves_wheelplan,
        ves_revenue_weight,
        ves_marked_for_export,
        ves_month_of_first_registration,
        ves_date_of_last_v5c_issued,
        tax_due_date,
        mot_due_date,
        last_dvla_sync,
        mot_make,
        mot_model,
        mot_fuel_type,
        mot_primary_colour,
        mot_registration,
        mot_year_of_manufacture,
        mot_first_used_date,
        last_mot_api_sync
      `)
      .eq('vehicle_id', vehicleId)
      .single();
    
    // Get history (RLS handles permission check)
    const { data: history, error } = await supabase
      .from('maintenance_history')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('created_at', { ascending: false });
    
    if (error) {
      logger.error('Failed to fetch history', error);
      throw error;
    }
    
    // Get workshop tasks for this vehicle
    // Use service role client to bypass RLS - maintenance history should show ALL workshop tasks
    // regardless of user permissions, as it's an audit trail
    const supabaseServiceRole = getSupabaseServiceRole();
    const { data: workshopTasks, error: workshopError } = await supabaseServiceRole
      .from('actions')
      .select(`
        id,
        created_at,
        status,
        workshop_comments,
        actioned_at,
        logged_at,
        created_by,
        workshop_task_categories (
          name
        )
      `)
      .eq('vehicle_id', vehicleId)
      .eq('action_type', 'workshop_vehicle_task')
      .order('created_at', { ascending: false });
    
    if (workshopError) {
      logger.error('Failed to fetch workshop tasks', workshopError);
      logger.error('Vehicle ID:', vehicleId);
      // Don't fail the whole request if workshop tasks fail
    } else {
      logger.info(`Fetched ${workshopTasks?.length || 0} workshop tasks for vehicle ${vehicleId}`);
      if (workshopTasks && workshopTasks.length > 0) {
        logger.info('Workshop tasks statuses:', workshopTasks.map(t => ({ id: t.id, status: t.status, created_at: t.created_at })));
      }
    }
    
    // Fetch profile names for workshop tasks using service role for consistency
    let tasksWithProfiles = workshopTasks || [];
    if (workshopTasks && workshopTasks.length > 0) {
      const userIds = [...new Set(workshopTasks.map(t => t.created_by).filter(Boolean))];
      if (userIds.length > 0) {
        const { data: profiles } = await supabaseServiceRole
          .from('profiles')
          .select('id, full_name')
          .in('id', userIds);
        
        const profileMap = new Map((profiles || []).map(p => [p.id, p.full_name]));
        tasksWithProfiles = workshopTasks.map(task => ({
          ...task,
          profiles: task.created_by ? { full_name: profileMap.get(task.created_by) || null } : null
        }));
      }
    }
    
    const response: MaintenanceHistoryResponse = {
      success: true,
      history: history || [],
      workshopTasks: tasksWithProfiles,
      vehicle: {
        id: vehicle.id,
        reg_number: vehicle.reg_number
      },
      vesData: maintenanceData || null
    };
    
    return NextResponse.json(response);
    
  } catch (error: any) {
    logger.error('GET /api/maintenance/history/[vehicleId] failed', error, 'MaintenanceAPI');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
