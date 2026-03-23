import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logServerError } from '@/lib/utils/server-error-logger';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/workshop-tasks/attachments/templates/[id]/questions
 * Get all questions for a template
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: templateId } = await params;
    const supabase = await createClient();
    type DbClient = { from: (t: string) => ReturnType<typeof supabase.from> };
    const db = supabase as unknown as DbClient;
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: questions, error } = await db
      .from('workshop_attachment_questions')
      .select('*')
      .eq('template_id', templateId)
      .order('sort_order', { ascending: true });

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      questions: questions || [],
    });
  } catch (error) {
    const { id: templateId } = await params;
    console.error('Error fetching template questions:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/workshop-tasks/attachments/templates/[id]/questions',
      additionalData: {
        endpoint: `GET /api/workshop-tasks/attachments/templates/${templateId}/questions`,
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/workshop-tasks/attachments/templates/[id]/questions
 * Add a question to a template (manager/admin only)
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: templateId } = await params;
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

    const body = await request.json();
    const { question_text, question_type, is_required, sort_order } = body;

    // Validate required fields
    if (!question_text?.trim()) {
      return NextResponse.json(
        { error: 'Missing required field: question_text' },
        { status: 400 }
      );
    }

    // Verify template exists
    const { data: template, error: templateError } = await db
      .from('workshop_attachment_templates')
      .select('id')
      .eq('id', templateId)
      .single();

    if (templateError || !template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    // Get max sort_order if not provided
    let finalSortOrder = sort_order;
    if (finalSortOrder === undefined) {
      const { data: maxQuestion } = await db
        .from('workshop_attachment_questions')
        .select('sort_order')
        .eq('template_id', templateId)
        .order('sort_order', { ascending: false })
        .limit(1)
        .single();
      
      finalSortOrder = (maxQuestion?.sort_order || 0) + 1;
    }

    // Insert question
    const { data: question, error: insertError } = await db
      .from('workshop_attachment_questions')
      .insert({
        template_id: templateId,
        question_text: question_text.trim(),
        question_type: question_type || 'checkbox',
        is_required: is_required || false,
        sort_order: finalSortOrder,
      } as never)
      .select('*')
      .single();

    if (insertError) {
      throw insertError;
    }

    return NextResponse.json({
      success: true,
      question,
    }, { status: 201 });
  } catch (error) {
    const { id: templateId } = await params;
    console.error('Error creating template question:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/workshop-tasks/attachments/templates/[id]/questions',
      additionalData: {
        endpoint: `POST /api/workshop-tasks/attachments/templates/${templateId}/questions`,
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
