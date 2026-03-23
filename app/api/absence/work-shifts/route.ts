import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminWorkShiftAccess } from '@/lib/server/absence-work-shift-auth';
import { getWorkShiftMatrix } from '@/lib/server/work-shifts';

export async function GET() {
  try {
    const auth = await requireAdminWorkShiftAccess();
    if (auth.response) {
      return auth.response;
    }

    const matrix = await getWorkShiftMatrix(createAdminClient());
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
