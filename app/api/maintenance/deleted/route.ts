import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/utils/logger';

/**
 * GET /api/maintenance/deleted
 * Returns all archived (deleted) vehicles from van_archive
 */
export async function GET(_request: NextRequest) {
  try {
    // Auth check
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    // Check permission (RLS will handle this, but we check explicitly for better errors)
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, role:roles(name, role_permissions(module_name, enabled))')
      .eq('id', user.id)
      .single();
    
    if (!profile) {
      return NextResponse.json(
        { error: 'Profile not found' },
        { status: 404 }
      );
    }
    
    // Fetch all archived vehicles ordered by most recently archived first
    const { data: archivedVehicles, error: archiveError } = await supabase
      .from('van_archive')
      .select('*')
      .order('archived_at', { ascending: false });
    
    if (archiveError) {
      logger.error('Failed to fetch archived vehicles', archiveError);
      throw archiveError;
    }
    
    // Transform archived data for UI
    const deletedVehicles = (archivedVehicles || []).map(archive => {
      // Extract fields from archived JSONB data
      const vehicleData = archive.vehicle_data as Record<string, unknown> | null;
      const maintenanceData = archive.maintenance_data as Record<string, unknown> | null;
      
      return {
        id: archive.id, // Archive record ID
        van_id: archive.van_id, // Original van ID
        reg_number: archive.reg_number,
        nickname: vehicleData?.nickname || null,
        current_mileage: maintenanceData?.current_mileage || null,
        tax_due_date: maintenanceData?.tax_due_date || null,
        mot_due_date: maintenanceData?.mot_due_date || null,
        archive_reason: archive.archive_reason,
        archived_at: archive.archived_at,
        archived_by: archive.archived_by,
        archive_comment: archive.archive_comment,
      };
    });
    
    return NextResponse.json({
      success: true,
      vehicles: deletedVehicles,
      count: deletedVehicles.length
    });
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('GET /api/maintenance/deleted failed', error, 'DeletedMaintenanceAPI');
    return NextResponse.json(
      { error: 'Internal server error', details: errorMessage },
      { status: 500 }
    );
  }
}

