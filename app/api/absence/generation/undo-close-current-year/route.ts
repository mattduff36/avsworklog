import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getProfileWithRole } from '@/lib/utils/permissions';
import { canEffectiveRoleAccessModule, isEffectiveRoleAdminOrSuper } from '@/lib/utils/rbac';
import { undoLatestClosedFinancialYearBookings } from '@/lib/services/absence-bank-holiday-sync';

export async function POST() {
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
    const isAdminOrSuper = await isEffectiveRoleAdminOrSuper();
    if (!profile || !canAccessAbsence || !isAdminOrSuper) {
      return NextResponse.json(
        { error: 'Forbidden: Admin absence access required' },
        { status: 403 }
      );
    }

    const result = await undoLatestClosedFinancialYearBookings({
      supabase,
      actorProfileId: profile.id,
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
          ? String((error as { message?: unknown }).message || 'Failed to undo close year')
          : 'Failed to undo close year';
    console.error('Error undoing closed financial year bookings:', error);
    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
