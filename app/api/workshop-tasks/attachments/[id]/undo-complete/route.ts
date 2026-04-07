import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logServerError } from '@/lib/utils/server-error-logger';
import { canUndoAttachmentCompletion } from '@/lib/workshop-attachments/completion-window';

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface AttachmentRow {
  id: string;
  status: string | null;
  completed_at: string | null;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: attachmentId } = await params;
    const supabase = await createClient();
    type DbClient = { from: (t: string) => ReturnType<typeof supabase.from> };
    const db = supabase as unknown as DbClient;
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: attachment, error: attachmentError } = await db
      .from('workshop_task_attachments')
      .select('id, status, completed_at')
      .eq('id', attachmentId)
      .single();

    if (attachmentError || !attachment) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }

    const typedAttachment = attachment as AttachmentRow;
    if (typedAttachment.status !== 'completed') {
      return NextResponse.json(
        { error: 'Only completed attachments can be moved back to draft.' },
        { status: 409 },
      );
    }

    if (!canUndoAttachmentCompletion(typedAttachment.completed_at)) {
      return NextResponse.json(
        { error: 'The 10-minute undo window has expired for this attachment.' },
        { status: 409 },
      );
    }

    const { error: updateError } = await db
      .from('workshop_task_attachments')
      .update({
        status: 'pending',
        completed_at: null,
        completed_by: null,
      } as never)
      .eq('id', attachmentId);

    if (updateError) {
      throw updateError;
    }

    return NextResponse.json({
      success: true,
      attachment_id: attachmentId,
      status: 'pending',
    });
  } catch (error) {
    const { id: attachmentId } = await params;
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/workshop-tasks/attachments/[id]/undo-complete',
      additionalData: {
        endpoint: `POST /api/workshop-tasks/attachments/${attachmentId}/undo-complete`,
      },
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
