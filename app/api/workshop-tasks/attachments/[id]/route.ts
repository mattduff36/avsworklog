import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logServerError } from '@/lib/utils/server-error-logger';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/workshop-tasks/attachments/[id]
 * Get a single attachment with template, questions, and responses
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    type DbClient = { from: (t: string) => ReturnType<typeof supabase.from> };
    const db = supabase as unknown as DbClient;
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get attachment with template
    const { data: attachment, error: attachmentError } = await db
      .from('workshop_task_attachments')
      .select(`
        *,
        workshop_attachment_templates (
          id,
          name,
          description,
          is_active
        )
      `)
      .eq('id', id)
      .single();

    if (attachmentError) {
      if (attachmentError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
      }
      throw attachmentError;
    }

    // Get questions for the template
    const { data: questions, error: questionsError } = await db
      .from('workshop_attachment_questions')
      .select('*')
      .eq('template_id', attachment.template_id)
      .order('sort_order', { ascending: true });

    if (questionsError) {
      throw questionsError;
    }

    // Get responses for this attachment
    const { data: responses, error: responsesError } = await db
      .from('workshop_attachment_responses')
      .select('*')
      .eq('attachment_id', id);

    if (responsesError) {
      throw responsesError;
    }

    return NextResponse.json({
      success: true,
      attachment: {
        ...attachment,
        questions: questions || [],
        responses: responses || [],
      },
    });
  } catch (error) {
    const { id } = await params;
    console.error('Error fetching attachment:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/workshop-tasks/attachments/[id]',
      additionalData: {
        endpoint: `GET /api/workshop-tasks/attachments/${id}`,
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/workshop-tasks/attachments/[id]
 * Delete an attachment (manager/admin only)
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    type DbClient = { from: (t: string) => ReturnType<typeof supabase.from> };
    const db = supabase as unknown as DbClient;
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canManageWorkshopTasks = await canEffectiveRoleAccessModule('workshop-tasks');
    if (!canManageWorkshopTasks) {
      return NextResponse.json(
        { error: 'Forbidden: Workshop Tasks access required' },
        { status: 403 }
      );
    }

    const { error: deleteError } = await db
      .from('workshop_task_attachments')
      .delete()
      .eq('id', id);

    if (deleteError) {
      throw deleteError;
    }

    return NextResponse.json({
      success: true,
      message: 'Attachment deleted',
    });
  } catch (error) {
    const { id } = await params;
    console.error('Error deleting attachment:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/workshop-tasks/attachments/[id]',
      additionalData: {
        endpoint: `DELETE /api/workshop-tasks/attachments/${id}`,
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
