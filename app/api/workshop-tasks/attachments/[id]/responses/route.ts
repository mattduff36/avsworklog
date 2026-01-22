import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logServerError } from '@/lib/utils/server-error-logger';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/workshop-tasks/attachments/[id]/responses
 * Get all responses for an attachment
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: attachmentId } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: responses, error } = await supabase
      .from('workshop_attachment_responses')
      .select('*')
      .eq('attachment_id', attachmentId);

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      responses: responses || [],
    });
  } catch (error) {
    const { id: attachmentId } = await params;
    console.error('Error fetching attachment responses:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/workshop-tasks/attachments/[id]/responses',
      additionalData: {
        endpoint: `GET /api/workshop-tasks/attachments/${attachmentId}/responses`,
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/workshop-tasks/attachments/[id]/responses
 * Save responses for an attachment (upsert)
 * Body: { responses: [{ question_id, response_value }] }
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: attachmentId } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { responses, mark_complete } = body;

    if (!Array.isArray(responses)) {
      return NextResponse.json(
        { error: 'Invalid request body: responses must be an array' },
        { status: 400 }
      );
    }

    // Get the attachment to verify it exists and get the template_id
    const { data: attachment, error: attachmentError } = await supabase
      .from('workshop_task_attachments')
      .select('*, workshop_attachment_templates(id, name)')
      .eq('id', attachmentId)
      .single();

    if (attachmentError || !attachment) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }

    // Get all questions for the template to create snapshots
    const { data: questions, error: questionsError } = await supabase
      .from('workshop_attachment_questions')
      .select('*')
      .eq('template_id', attachment.template_id);

    if (questionsError) {
      throw questionsError;
    }

    const questionsMap = new Map(questions?.map(q => [q.id, q]) || []);

    // Process each response
    const processedResponses = [];
    for (const resp of responses) {
      if (!resp.question_id) continue;

      const question = questionsMap.get(resp.question_id);
      if (!question) continue;

      // Create question snapshot
      const questionSnapshot = {
        question_text: question.question_text,
        question_type: question.question_type,
        is_required: question.is_required,
      };

      processedResponses.push({
        attachment_id: attachmentId,
        question_id: resp.question_id,
        question_snapshot: questionSnapshot,
        response_value: resp.response_value?.toString() || null,
      });
    }

    // Upsert responses (delete existing, insert new)
    if (processedResponses.length > 0) {
      // Delete existing responses for this attachment
      await supabase
        .from('workshop_attachment_responses')
        .delete()
        .eq('attachment_id', attachmentId);

      // Insert new responses
      const { error: insertError } = await supabase
        .from('workshop_attachment_responses')
        .insert(processedResponses);

      if (insertError) {
        throw insertError;
      }
    }

    // Update attachment status if requested
    if (mark_complete) {
      const { error: updateError } = await supabase
        .from('workshop_task_attachments')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          completed_by: user.id,
        })
        .eq('id', attachmentId);

      if (updateError) {
        throw updateError;
      }
    }

    // Fetch updated responses
    const { data: updatedResponses, error: fetchError } = await supabase
      .from('workshop_attachment_responses')
      .select('*')
      .eq('attachment_id', attachmentId);

    if (fetchError) {
      throw fetchError;
    }

    // Fetch updated attachment
    const { data: updatedAttachment } = await supabase
      .from('workshop_task_attachments')
      .select('*')
      .eq('id', attachmentId)
      .single();

    return NextResponse.json({
      success: true,
      responses: updatedResponses || [],
      attachment: updatedAttachment,
    });
  } catch (error) {
    const { id: attachmentId } = await params;
    console.error('Error saving attachment responses:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/workshop-tasks/attachments/[id]/responses',
      additionalData: {
        endpoint: `POST /api/workshop-tasks/attachments/${attachmentId}/responses`,
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
