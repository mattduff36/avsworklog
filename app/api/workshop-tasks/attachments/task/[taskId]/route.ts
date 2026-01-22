import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logServerError } from '@/lib/utils/server-error-logger';

interface RouteParams {
  params: Promise<{ taskId: string }>;
}

/**
 * GET /api/workshop-tasks/attachments/task/[taskId]
 * Get all attachments for a task with their templates and responses
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { taskId } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get attachments with templates
    const { data: attachments, error: attachmentsError } = await supabase
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
      .eq('task_id', taskId)
      .order('created_at', { ascending: true });

    if (attachmentsError) {
      throw attachmentsError;
    }

    // Get all responses for these attachments
    const attachmentIds = (attachments || []).map(a => a.id);
    let responses: any[] = [];
    
    if (attachmentIds.length > 0) {
      const { data: responsesData, error: responsesError } = await supabase
        .from('workshop_attachment_responses')
        .select('*')
        .in('attachment_id', attachmentIds);

      if (responsesError) {
        throw responsesError;
      }
      responses = responsesData || [];
    }

    // Get questions for the templates
    const templateIds = [...new Set((attachments || []).map(a => a.template_id))];
    let questions: any[] = [];
    
    if (templateIds.length > 0) {
      const { data: questionsData, error: questionsError } = await supabase
        .from('workshop_attachment_questions')
        .select('*')
        .in('template_id', templateIds)
        .order('sort_order', { ascending: true });

      if (questionsError) {
        throw questionsError;
      }
      questions = questionsData || [];
    }

    // Combine data
    const result = (attachments || []).map(attachment => ({
      ...attachment,
      questions: questions.filter(q => q.template_id === attachment.template_id),
      responses: responses.filter(r => r.attachment_id === attachment.id),
    }));

    return NextResponse.json({
      success: true,
      attachments: result,
    });
  } catch (error) {
    const { taskId } = await params;
    console.error('Error fetching task attachments:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/workshop-tasks/attachments/task/[taskId]',
      additionalData: {
        endpoint: `GET /api/workshop-tasks/attachments/task/${taskId}`,
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/workshop-tasks/attachments/task/[taskId]
 * Add an attachment to a task
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { taskId } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { template_id } = body;

    // Validate required fields
    if (!template_id) {
      return NextResponse.json(
        { error: 'Missing required field: template_id' },
        { status: 400 }
      );
    }

    // Verify task exists and is a workshop task
    const { data: task, error: taskError } = await supabase
      .from('actions')
      .select('id, action_type')
      .eq('id', taskId)
      .single();

    if (taskError || !task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (!['inspection_defect', 'workshop_vehicle_task'].includes(task.action_type)) {
      return NextResponse.json(
        { error: 'Attachments can only be added to workshop tasks' },
        { status: 400 }
      );
    }

    // Verify template exists
    const { data: template, error: templateError } = await supabase
      .from('workshop_attachment_templates')
      .select('id')
      .eq('id', template_id)
      .single();

    if (templateError || !template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    // Check if attachment already exists for this task+template
    const { data: existingAttachment, error: duplicateCheckError } = await supabase
      .from('workshop_task_attachments')
      .select('id')
      .eq('task_id', taskId)
      .eq('template_id', template_id)
      .single();

    // Handle errors - PGRST116 means no rows found (expected), other errors should be thrown
    if (duplicateCheckError && duplicateCheckError.code !== 'PGRST116') {
      throw duplicateCheckError;
    }

    if (existingAttachment) {
      return NextResponse.json(
        { error: 'This template is already attached to this task' },
        { status: 409 }
      );
    }

    // Create attachment
    const { data: attachment, error: insertError } = await supabase
      .from('workshop_task_attachments')
      .insert({
        task_id: taskId,
        template_id,
        status: 'pending',
        created_by: user.id,
      })
      .select(`
        *,
        workshop_attachment_templates (
          id,
          name,
          description,
          is_active
        )
      `)
      .single();

    if (insertError) {
      throw insertError;
    }

    // Get questions for the template
    const { data: questions } = await supabase
      .from('workshop_attachment_questions')
      .select('*')
      .eq('template_id', template_id)
      .order('sort_order', { ascending: true });

    return NextResponse.json({
      success: true,
      attachment: {
        ...attachment,
        questions: questions || [],
        responses: [],
      },
    }, { status: 201 });
  } catch (error) {
    const { taskId } = await params;
    console.error('Error creating task attachment:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/workshop-tasks/attachments/task/[taskId]',
      additionalData: {
        endpoint: `POST /api/workshop-tasks/attachments/task/${taskId}`,
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
