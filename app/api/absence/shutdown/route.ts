import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getProfileWithRole } from '@/lib/utils/permissions';
import { bookCompanyShutdownForAllStaff } from '@/lib/services/absence-bank-holiday-sync';

interface ShutdownPayload {
  startDate?: string;
  endDate?: string;
  notes?: string;
  confirm?: boolean;
}

export async function POST(request: NextRequest) {
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

    const payload = (await request.json()) as ShutdownPayload;
    if (!payload.startDate) {
      return NextResponse.json({ error: 'Start date is required' }, { status: 400 });
    }

    const result = await bookCompanyShutdownForAllStaff({
      supabase,
      actorProfileId: profile.id,
      startDate: payload.startDate,
      endDate: payload.endDate,
      notes: payload.notes,
      confirm: payload.confirm === true,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('Error booking company shutdown:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to book shutdown leave' },
      { status: 500 }
    );
  }
}
