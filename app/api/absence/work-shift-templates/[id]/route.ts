import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminWorkShiftAccess } from '@/lib/server/absence-work-shift-auth';
import { deleteWorkShiftTemplate, updateWorkShiftTemplate } from '@/lib/server/work-shifts';
import type { UpdateWorkShiftTemplateRequest } from '@/types/work-shifts';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdminWorkShiftAccess();
    if (auth.response) {
      return auth.response;
    }

    const { id } = await params;
    const body = (await request.json()) as UpdateWorkShiftTemplateRequest;
    const template = await updateWorkShiftTemplate(createAdminClient(), id, body);

    return NextResponse.json({
      success: true,
      template,
    });
  } catch (error) {
    console.error('Error updating work shift template:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update work shift template' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdminWorkShiftAccess();
    if (auth.response) {
      return auth.response;
    }

    const { id } = await params;
    await deleteWorkShiftTemplate(createAdminClient(), id);

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error('Error deleting work shift template:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete work shift template' },
      { status: 500 }
    );
  }
}
