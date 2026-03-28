import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getWorkShiftAccessContext } from '@/lib/server/work-shift-access';
import { applyTemplateToProfiles } from '@/lib/server/work-shifts';
import type { ApplyWorkShiftTemplateRequest } from '@/types/work-shifts';

export async function POST(request: NextRequest) {
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

    const body = (await request.json()) as ApplyWorkShiftTemplateRequest;
    if (!body?.templateId) {
      return NextResponse.json({ error: 'Template id is required' }, { status: 400 });
    }

    const admin = createAdminClient();
    let profileIds = body.profileIds || [];

    if ((body.mode || 'selected') === 'all') {
      if (!access.context.isAdmin && !access.context.teamId) {
        profileIds = [];
      } else {
        const profilesQuery = access.context.isAdmin
          ? admin.from('profiles').select('id')
          : admin.from('profiles').select('id').eq('team_id', access.context.teamId as string);
        const { data, error } = await profilesQuery;
        if (error) {
          throw error;
        }

        profileIds = ((data || []) as Array<{ id: string }>).map((row) => row.id);
      }
    } else if (!access.context.isAdmin) {
      if (!access.context.teamId) {
        return NextResponse.json({ error: 'Forbidden: No team scope available' }, { status: 403 });
      }

      const { data: scopedRows, error: scopedError } = await admin
        .from('profiles')
        .select('id')
        .eq('team_id', access.context.teamId)
        .in('id', profileIds);
      if (scopedError) {
        throw scopedError;
      }

      const scopedProfileIds = new Set(((scopedRows || []) as Array<{ id: string }>).map((row) => row.id));
      if (profileIds.some((profileId) => !scopedProfileIds.has(profileId))) {
        return NextResponse.json({ error: 'Forbidden: One or more employees are outside your team scope' }, { status: 403 });
      }
    }

    if (profileIds.length === 0) {
      return NextResponse.json({ error: 'At least one employee is required' }, { status: 400 });
    }

    const result = await applyTemplateToProfiles(admin, body.templateId, profileIds);
    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('Error applying work shift template:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to apply work shift template' },
      { status: 500 }
    );
  }
}
