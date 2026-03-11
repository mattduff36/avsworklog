import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getProfileWithRole } from '@/lib/utils/permissions';
import { removeLatestGeneratedFinancialYear } from '@/lib/services/absence-bank-holiday-sync';

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
    if (!profile?.role?.is_manager_admin) {
      return NextResponse.json(
        { error: 'Forbidden: Manager or Admin access required' },
        { status: 403 }
      );
    }

    const result = await removeLatestGeneratedFinancialYear({ supabase });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('Error removing generated financial year allowances:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to remove generated year' },
      { status: 500 }
    );
  }
}
