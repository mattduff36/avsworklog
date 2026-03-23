import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAbsenceUser } from '@/lib/server/absence-work-shift-auth';
import { getCurrentUserWorkShift } from '@/lib/server/work-shifts';

export async function GET() {
  try {
    const auth = await requireAbsenceUser();
    if (auth.response || !auth.user) {
      return auth.response;
    }

    const workShift = await getCurrentUserWorkShift(createAdminClient(), auth.user.id);
    return NextResponse.json({
      success: true,
      ...workShift,
    });
  } catch (error) {
    console.error('Error loading current work shift:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load current work shift' },
      { status: 500 }
    );
  }
}
