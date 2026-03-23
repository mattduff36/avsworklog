import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logServerError } from '@/lib/utils/server-error-logger';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canManageTimesheets = await canEffectiveRoleAccessModule('approvals');
    if (!canManageTimesheets) {
      return NextResponse.json(
        { error: 'Forbidden: Approvals access required' },
        { status: 403 }
      );
    }

    const timesheetId = (await params).id;

    // Delete timesheet (cascade will delete entries)
    const { error: deleteError } = await supabase
      .from('timesheets')
      .delete()
      .eq('id', timesheetId);

    if (deleteError) {
      console.error('Delete error:', deleteError);
      return NextResponse.json(
        { error: 'Failed to delete timesheet' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting timesheet:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/timesheets/[id]/delete',
      additionalData: {
        endpoint: '/api/timesheets/[id]/delete',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

