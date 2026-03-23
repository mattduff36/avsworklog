import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminWorkShiftAccess, requireManagerWorkShiftReadAccess } from '@/lib/server/absence-work-shift-auth';
import { getCurrentUserWorkShift, updateEmployeeWorkShift } from '@/lib/server/work-shifts';
import type { UpdateEmployeeWorkShiftRequest } from '@/types/work-shifts';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  try {
    const auth = await requireManagerWorkShiftReadAccess();
    if (auth.response) {
      return auth.response;
    }

    const { profileId } = await params;
    const workShift = await getCurrentUserWorkShift(createAdminClient(), profileId);

    return NextResponse.json({
      success: true,
      ...workShift,
    });
  } catch (error) {
    console.error('Error loading employee work shift:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load employee work shift' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  try {
    const auth = await requireAdminWorkShiftAccess();
    if (auth.response) {
      return auth.response;
    }

    const { profileId } = await params;
    const body = (await request.json()) as UpdateEmployeeWorkShiftRequest;

    if (!body?.pattern || typeof body.pattern !== 'object') {
      return NextResponse.json({ error: 'Pattern payload is required' }, { status: 400 });
    }

    const result = await updateEmployeeWorkShift(createAdminClient(), profileId, {
      templateId: body.templateId ?? null,
      pattern: body.pattern,
    });

    return NextResponse.json({
      success: true,
      row: result.row,
      recalculatedAbsences: result.recalculatedAbsences,
    });
  } catch (error) {
    console.error('Error updating employee work shift:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update employee work shift' },
      { status: 500 }
    );
  }
}
