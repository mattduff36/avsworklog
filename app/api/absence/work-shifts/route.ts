import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getWorkShiftAccessContext } from '@/lib/server/work-shift-access';
import { getWorkShiftMatrix } from '@/lib/server/work-shifts';

export async function GET() {
  try {
    const access = await getWorkShiftAccessContext();
    if (access.response) {
      return access.response;
    }
    if (!access.context) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!access.context.canView) {
      return NextResponse.json({ error: 'Forbidden: Work shifts access required' }, { status: 403 });
    }

    const matrix = await getWorkShiftMatrix(createAdminClient(), {
      enforceTeamScope: !access.context.isAdmin,
      teamId: access.context.teamId,
    });
    return NextResponse.json({
      success: true,
      templates: matrix.templates,
      employees: matrix.employees,
    });
  } catch (error) {
    console.error('Error loading work shifts:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load work shifts' },
      { status: 500 }
    );
  }
}
