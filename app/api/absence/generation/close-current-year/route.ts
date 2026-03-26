import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getProfileWithRole } from '@/lib/utils/permissions';
import { closeCurrentFinancialYearBookings } from '@/lib/services/absence-bank-holiday-sync';
import { canEffectiveRoleAccessModule, isEffectiveRoleManagerOrHigher } from '@/lib/utils/rbac';

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const profile = await getProfileWithRole(user.id);
    const canAccessAbsence = await canEffectiveRoleAccessModule('absence');
    const isManagerOrHigher = await isEffectiveRoleManagerOrHigher();
    if (!profile || !canAccessAbsence || !isManagerOrHigher) {
      return NextResponse.json(
        { error: 'Forbidden: Manager or admin absence access required' },
        { status: 403 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      notes?: string;
    };

    const result = await closeCurrentFinancialYearBookings({
      supabase,
      actorProfileId: profile.id,
      notes: body.notes,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'object' && error !== null && 'message' in error
          ? String((error as { message?: unknown }).message || 'Failed to close current year')
          : 'Failed to close current year';
    console.error('Error closing current financial year bookings:', error);
    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
