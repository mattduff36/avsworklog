import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isManagerOrAdmin } from '@/lib/utils/permissions';
import { logServerError } from '@/lib/utils/server-error-logger';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PUT /api/workshop-tasks/attachments/questions/[id]
 * Update a question (manager/admin only)
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check manager/admin permission
    const isManager = await isManagerOrAdmin(user.id);
    if (!isManager) {
      return NextResponse.json(
        { error: 'Forbidden: Manager or Admin access required' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { question_text, question_type, is_required, sort_order } = body;

    // Build update object
    const updates: Record<string, unknown> = {};
    if (question_text !== undefined) updates.question_text = question_text.trim();
    if (question_type !== undefined) updates.question_type = question_type;
    if (is_required !== undefined) updates.is_required = is_required;
    if (sort_order !== undefined) updates.sort_order = sort_order;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    const { data: question, error: updateError } = await supabase
      .from('workshop_attachment_questions')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (updateError) {
      if (updateError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Question not found' }, { status: 404 });
      }
      throw updateError;
    }

    return NextResponse.json({
      success: true,
      question,
    });
  } catch (error) {
    const { id } = await params;
    console.error('Error updating question:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/workshop-tasks/attachments/questions/[id]',
      additionalData: {
        endpoint: `PUT /api/workshop-tasks/attachments/questions/${id}`,
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/workshop-tasks/attachments/questions/[id]
 * Delete a question (manager/admin only)
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check manager/admin permission
    const isManager = await isManagerOrAdmin(user.id);
    if (!isManager) {
      return NextResponse.json(
        { error: 'Forbidden: Manager or Admin access required' },
        { status: 403 }
      );
    }

    const { error: deleteError } = await supabase
      .from('workshop_attachment_questions')
      .delete()
      .eq('id', id);

    if (deleteError) {
      throw deleteError;
    }

    return NextResponse.json({
      success: true,
      message: 'Question deleted',
    });
  } catch (error) {
    const { id } = await params;
    console.error('Error deleting question:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/workshop-tasks/attachments/questions/[id]',
      additionalData: {
        endpoint: `DELETE /api/workshop-tasks/attachments/questions/${id}`,
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
