import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/utils/logger';

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
 * GET /api/maintenance/history/plant/[plantId]
 * Returns maintenance history for a plant asset
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ plantId: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Await params (Next.js 15 requirement)
    const { plantId } = await params;
    
    // Get plant info
    const { data: plant, error: plantError } = await supabase
      .from('plant')
      .select('id, plant_id, nickname')
      .eq('id', plantId)
      .single();
    
    if (plantError || !plant) {
      return NextResponse.json({ error: 'Plant not found' }, { status: 404 });
    }
    
    // Get maintenance record with current hours and service data
    const { data: maintenanceData } = await supabase
      .from('vehicle_maintenance')
      .select(`
        current_hours,
        last_service_hours,
        next_service_hours,
        last_hours_update,
        tracker_id
      `)
      .eq('plant_id', plantId)
      .maybeSingle();
    
    // Get history (RLS handles permission check)
    const { data: history, error } = await supabase
      .from('maintenance_history')
      .select('*')
      .eq('plant_id', plantId)
      .order('created_at', { ascending: false });
    
    if (error) {
      logger.error('Failed to fetch plant history', error);
      throw error;
    }
    
    // Get workshop tasks for this plant
    // Use service role client to bypass RLS - maintenance history should show ALL workshop tasks
    // regardless of user permissions, as it's an audit trail
    const supabaseServiceRole = getSupabaseServiceRole();
    
    const { data: workshopTasks, error: tasksError } = await supabaseServiceRole
      .from('actions')
      .select(`
        id,
        created_at,
        status,
        action_type,
        title,
        status_history,
        workshop_comments,
        description,
        logged_comment,
        actioned_comment,
        actioned_at,
        logged_at,
        created_by,
        workshop_task_categories (
          name
        )
      `)
      .eq('plant_id', plantId)
      .order('created_at', { ascending: false });
    
    if (tasksError) {
      logger.error('Failed to fetch workshop tasks', tasksError);
      logger.error('Plant ID:', plantId);
      // Don't fail the whole request if workshop tasks fail
    } else {
      logger.info(`Fetched ${workshopTasks?.length || 0} workshop tasks for plant ${plantId}`);
    }
    
    // Fetch profile names for workshop tasks using service role for consistency
    let tasksWithProfiles = workshopTasks || [];
    if (workshopTasks && workshopTasks.length > 0) {
      const userIds = [...new Set(workshopTasks.map(t => t.created_by).filter(Boolean))];
      
      if (userIds.length > 0) {
        // Fetch profiles from database
        const { data: profiles } = await supabaseServiceRole
          .from('profiles')
          .select('id, full_name')
          .in('id', userIds);
        
        const profileMap = new Map((profiles || []).map(p => [p.id, p.full_name]));
        tasksWithProfiles = workshopTasks.map(task => ({
          ...task,
          profiles: task.created_by ? { full_name: profileMap.get(task.created_by) || null } : null
        }));
      } else {
        // No user IDs to fetch, but still need to add profiles property (as null) to each task
        tasksWithProfiles = workshopTasks.map(task => ({
          ...task,
          profiles: null
        }));
      }
    }
    
    const response = {
      success: true,
      history: history || [],
      workshopTasks: tasksWithProfiles,
      plant: {
        id: plant.id,
        plant_id: plant.plant_id,
        nickname: plant.nickname
      },
      maintenanceData: maintenanceData || null
    };
    
    return NextResponse.json(response);
    
  } catch (error: any) {
    logger.error('GET /api/maintenance/history/plant/[plantId] failed', error, 'MaintenanceAPI');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
