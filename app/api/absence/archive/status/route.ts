import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getProfileWithRole } from '@/lib/utils/permissions';
import { getAbsenceArchiveStatus } from '@/lib/services/absence-archive';

export async function GET() {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const profile = await getProfileWithRole(user.id);
    if (!profile?.role?.is_manager_admin) {
      return NextResponse.json(
        { error: 'Forbidden: Manager or Admin access required' },
        { status: 403 }
      );
    }

    const status = await getAbsenceArchiveStatus(supabase);
    return NextResponse.json({ success: true, ...status });
  } catch (error) {
    console.error('Error loading absence archive status:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load archive status',
      },
      { status: 500 }
    );
  }
}
