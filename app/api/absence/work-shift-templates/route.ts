import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminWorkShiftAccess } from '@/lib/server/absence-work-shift-auth';
import { createWorkShiftTemplate } from '@/lib/server/work-shifts';
import type { CreateWorkShiftTemplateRequest } from '@/types/work-shifts';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdminWorkShiftAccess();
    if (auth.response) {
      return auth.response;
    }

    const body = (await request.json()) as CreateWorkShiftTemplateRequest;
    if (!body?.name?.trim()) {
      return NextResponse.json({ error: 'Template name is required' }, { status: 400 });
    }

    if (!body?.pattern || typeof body.pattern !== 'object') {
      return NextResponse.json({ error: 'Template pattern is required' }, { status: 400 });
    }

    const template = await createWorkShiftTemplate(createAdminClient(), body);
    return NextResponse.json({
      success: true,
      template,
    });
  } catch (error) {
    console.error('Error creating work shift template:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create work shift template' },
      { status: 500 }
    );
  }
}
