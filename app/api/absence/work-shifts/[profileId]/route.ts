import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { canAccessProfileForScopedWorkShift, getWorkShiftAccessContext } from '@/lib/server/work-shift-access';
import { getCurrentUserWorkShift, updateEmployeeWorkShift } from '@/lib/server/work-shifts';
import type { UpdateEmployeeWorkShiftRequest } from '@/types/work-shifts';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  try {
    const access = await getWorkShiftAccessContext();
    if (access.response) {
      return access.response;
    }
    if (!access.context) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!access.context.canView) {
      return NextResponse.json({ error: 'Forbidden: Work shifts access required' }, { status: 403 });
    }

    const { profileId } = await params;
    const admin = createAdminClient() as unknown as {
      from: (table: string) => {
        select: (columns: string) => {
          eq: (column: string, value: string) => {
            maybeSingle: () => Promise<{ data: { team_id: string | null } | null; error: { message: string } | null }>;
          };
        };
      };
    };
    const canAccessTarget = await canAccessProfileForScopedWorkShift(admin, access.context, profileId);
    if (!canAccessTarget) {
      return NextResponse.json({ error: 'Forbidden: Out of scope for this team' }, { status: 403 });
    }

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
    const access = await getWorkShiftAccessContext();
    if (access.response) {
      return access.response;
    }
    if (!access.context) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!access.context.canEdit) {
      return NextResponse.json({ error: 'Forbidden: Work shifts edit access required' }, { status: 403 });
    }

    const { profileId } = await params;
    const body = (await request.json()) as UpdateEmployeeWorkShiftRequest;

    if (!body?.pattern || typeof body.pattern !== 'object') {
      return NextResponse.json({ error: 'Pattern payload is required' }, { status: 400 });
    }

    const admin = createAdminClient() as unknown as {
      from: (table: string) => {
        select: (columns: string) => {
          eq: (column: string, value: string) => {
            maybeSingle: () => Promise<{ data: { team_id: string | null } | null; error: { message: string } | null }>;
          };
        };
      };
    };
    const canAccessTarget = await canAccessProfileForScopedWorkShift(admin, access.context, profileId);
    if (!canAccessTarget) {
      return NextResponse.json({ error: 'Forbidden: Out of scope for this team' }, { status: 403 });
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
