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
      const { error: deleteError } = await supabase
        .from('workshop_attachment_responses')
        .delete()
        .eq('attachment_id', attachmentId);

      if (deleteError) {
        throw deleteError;
      }

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
      // Prevent marking as complete if no valid responses were saved
      if (processedResponses.length === 0) {
        return NextResponse.json(
          { error: 'Cannot mark attachment as complete without valid responses' },
          { status: 400 }
        );
      }

      // Validate all required questions have been answered with valid values
      const requiredQuestions = questions?.filter(q => q.is_required) || [];
      const responsesByQuestionId = new Map(processedResponses.map(r => [r.question_id, r.response_value]));
      const invalidRequiredQuestions = requiredQuestions.filter(q => {
        const responseValue = responsesByQuestionId.get(q.id);
        
        // No response at all
        if (responseValue === undefined) {
          return true;
        }
        
        // For checkboxes, 'false' means unchecked (invalid for required fields)
        if (q.question_type === 'checkbox') {
          return responseValue !== 'true';
        }
        
        // For other types, empty or whitespace-only values are invalid
        return !responseValue || responseValue.trim() === '';
      });

      if (invalidRequiredQuestions.length > 0) {
        return NextResponse.json(
          { 
            error: 'Cannot mark attachment as complete: required questions not properly answered',
            missingQuestions: invalidRequiredQuestions.map(q => q.question_text)
          },
          { status: 400 }
        );
      }

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
