import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getProfileWithRole } from '@/lib/utils/permissions';
import { generateNextFinancialYearAllowances } from '@/lib/services/absence-bank-holiday-sync';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';

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
    if (!profile || !canAccessAbsence) {
      return NextResponse.json(
        { error: 'Forbidden: Absence access required' },
        { status: 403 }
      );
    }

    const result = await generateNextFinancialYearAllowances({
      supabase,
      actorProfileId: profile.id,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('Error generating next financial year allowances:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to generate allowances' },
      { status: 500 }
    );
  }
}
