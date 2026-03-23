import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminWorkShiftAccess } from '@/lib/server/absence-work-shift-auth';
import { applyTemplateToProfiles } from '@/lib/server/work-shifts';
import type { ApplyWorkShiftTemplateRequest } from '@/types/work-shifts';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdminWorkShiftAccess();
    if (auth.response) {
      return auth.response;
    }

    const body = (await request.json()) as ApplyWorkShiftTemplateRequest;
    if (!body?.templateId) {
      return NextResponse.json({ error: 'Template id is required' }, { status: 400 });
    }

    const admin = createAdminClient();
    let profileIds = body.profileIds || [];

    if ((body.mode || 'selected') === 'all') {
      const { data, error } = await admin.from('profiles').select('id');
      if (error) {
        throw error;
      }

      profileIds = ((data || []) as Array<{ id: string }>).map((row) => row.id);
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
