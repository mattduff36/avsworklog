import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getProfileWithRole } from '@/lib/utils/permissions';
import { seedFinancialYearBankHolidays } from '@/lib/services/absence-bank-holiday-sync';

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

    const body = (await request.json().catch(() => ({}))) as {
      financialYearStartYear?: number;
      dryRun?: boolean;
    };

    const result = await seedFinancialYearBankHolidays({
      supabase,
      financialYearStartYear: body.financialYearStartYear,
      dryRun: body.dryRun === true,
    });

    return NextResponse.json({
      success: true,
      ...result,
      dryRun: body.dryRun === true,
    });
  } catch (error) {
    console.error('Error seeding absence bank holidays:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to seed bank holidays',
      },
      { status: 500 }
    );
  }
}
