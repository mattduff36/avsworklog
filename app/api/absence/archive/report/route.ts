import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getProfileWithRole } from '@/lib/utils/permissions';
import { getAbsenceArchiveReport } from '@/lib/services/absence-archive';

function parsePositiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return parsed;
}

export async function GET(request: NextRequest) {
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

    const params = request.nextUrl.searchParams;
    const financialYearStartYearRaw = params.get('financialYearStartYear');
    const financialYearStartYear =
      financialYearStartYearRaw && financialYearStartYearRaw.trim().length > 0
        ? Number.parseInt(financialYearStartYearRaw, 10)
        : undefined;

    const result = await getAbsenceArchiveReport(supabase, {
      financialYearStartYear:
        financialYearStartYear !== undefined && !Number.isNaN(financialYearStartYear)
          ? financialYearStartYear
          : undefined,
      profileId: params.get('profileId') || undefined,
      reasonId: params.get('reasonId') || undefined,
      status: params.get('status') || undefined,
      page: parsePositiveInt(params.get('page'), 1),
      pageSize: parsePositiveInt(params.get('pageSize'), 50),
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('Error loading absence archive report:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load archive report',
      },
      { status: 500 }
    );
  }
}
