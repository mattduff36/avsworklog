import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getProfileWithRole } from '@/lib/utils/permissions';
import { logger } from '@/lib/utils/logger';
import { logServerError } from '@/lib/utils/server-error-logger';

/**
 * DELETE /api/maintenance/deleted/[archiveId]
 * Permanently removes an archived vehicle record
 * RESTRICTED: Admin/Manager only
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ archiveId: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    // Check if user is admin or manager
    const profile = await getProfileWithRole(user.id);
    
    if (!profile || !['admin', 'manager'].includes(profile.role?.name || '')) {
      return NextResponse.json(
        { error: 'Forbidden: Admin or Manager access required' },
        { status: 403 }
      );
    }
    
    const archiveId = (await params).archiveId;
    
    // Get archive record before deleting (for logging)
    const { data: archive } = await supabase
      .from('vehicle_archive')
      .select('reg_number, archive_reason')
      .eq('id', archiveId)
      .single();
    
    // Permanently delete the archived vehicle record
    const { error: deleteError } = await supabase
      .from('vehicle_archive')
      .delete()
      .eq('id', archiveId);
    
    if (deleteError) {
      logger.error('Failed to permanently delete archived vehicle', deleteError);
      throw deleteError;
    }
    
    logger.info(
      `Archived vehicle permanently removed: ${archive?.reg_number || archiveId}`,
      { archiveId, reg_number: archive?.reg_number, reason: archive?.archive_reason, deletedBy: user.id }
    );
    
    return NextResponse.json({
      success: true,
      message: 'Archived vehicle permanently removed'
    });
    
  } catch (error: any) {
    logger.error('DELETE /api/maintenance/deleted/[archiveId] failed', error, 'DeletedMaintenanceAPI');
    
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/maintenance/deleted/[archiveId]',
      additionalData: {
        endpoint: '/api/maintenance/deleted/[archiveId]',
      },
    });
    
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}

