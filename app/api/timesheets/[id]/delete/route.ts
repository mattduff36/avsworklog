import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getProfileWithRole } from '@/lib/utils/permissions';
import { validateParams, IdParamsSchema } from '@/lib/validation/schemas';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    
    // Validate params
    const paramsResult = validateParams(await params, IdParamsSchema);
    if (!paramsResult.success) {
      return NextResponse.json(
        { success: false, error: paramsResult.error },
        { status: 400 }
      );
    }
    const timesheetId = paramsResult.data.id;

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is manager or admin
    const profile = await getProfileWithRole(user.id);

    if (!profile || !profile.role?.is_manager_admin) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: Manager or Admin access required' },
        { status: 403 }
      );
    }

    // Delete timesheet (cascade will delete entries)
    const { error: deleteError } = await supabase
      .from('timesheets')
      .delete()
      .eq('id', timesheetId);

    if (deleteError) {
      console.error('Delete error:', deleteError);
      return NextResponse.json(
        { success: false, error: 'Failed to delete timesheet' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, message: 'Timesheet deleted successfully' });
  } catch (error) {
    console.error('Error deleting timesheet:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

