import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isManagerOrAdmin } from '@/lib/utils/permissions';
import { logServerError } from '@/lib/utils/server-error-logger';
import { UUIDSchema } from '@/lib/validation/schemas';

/**
 * PATCH /api/workshop-tasks/comments/:commentId
 * Update a comment (author or manager/admin only)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ commentId: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Validate commentId
    const { commentId } = await params;
    const commentIdValidation = UUIDSchema.safeParse(commentId);
    if (!commentIdValidation.success) {
      return NextResponse.json({ error: 'Invalid comment ID' }, { status: 400 });
    }

    // Parse and validate body
    const body = await request.json();
    const bodyText = body.body?.trim();

    if (!bodyText || bodyText.length < 1) {
      return NextResponse.json({ error: 'Comment cannot be empty' }, { status: 400 });
    }

    if (bodyText.length > 1000) {
      return NextResponse.json({ error: 'Comment must be less than 1000 characters' }, { status: 400 });
    }

    // Fetch comment to check ownership
    const { data: existingComment, error: fetchError } = await supabase
      .from('workshop_task_comments')
      .select('id, author_id, task_id')
      .eq('id', commentId)
      .single();

    if (fetchError || !existingComment) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
    }

    // Check permission: author or manager/admin
    const isAuthor = existingComment.author_id === user.id;
    const isManager = await isManagerOrAdmin(user.id);

    if (!isAuthor && !isManager) {
      return NextResponse.json(
        { error: 'Forbidden: You can only edit your own comments' },
        { status: 403 }
      );
    }

    // Update comment
    const { data: updatedComment, error: updateError } = await supabase
      .from('workshop_task_comments')
      .update({
        body: bodyText,
      })
      .eq('id', commentId)
      .select(`
        id,
        task_id,
        body,
        created_at,
        updated_at,
        author_id,
        profiles:author_id (
          id,
          full_name
        )
      `)
      .single();

    if (updateError) {
      throw updateError;
    }

    return NextResponse.json({
      success: true,
      comment: {
        id: updatedComment.id,
        type: 'comment',
        created_at: updatedComment.created_at,
        updated_at: updatedComment.updated_at,
        author: updatedComment.profiles ? {
          id: (updatedComment.profiles as any).id,
          full_name: (updatedComment.profiles as any).full_name,
        } : null,
        body: updatedComment.body,
        can_edit: isAuthor || isManager,
        can_delete: isAuthor || isManager,
      },
    });
  } catch (error) {
    console.error('Error updating comment:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/workshop-tasks/comments/[commentId]',
      additionalData: {
        endpoint: 'PATCH /api/workshop-tasks/comments/[commentId]',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/workshop-tasks/comments/:commentId
 * Delete a comment (author or manager/admin only)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ commentId: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Validate commentId
    const { commentId } = await params;
    const commentIdValidation = UUIDSchema.safeParse(commentId);
    if (!commentIdValidation.success) {
      return NextResponse.json({ error: 'Invalid comment ID' }, { status: 400 });
    }

    // Fetch comment to check ownership
    const { data: existingComment, error: fetchError } = await supabase
      .from('workshop_task_comments')
      .select('id, author_id')
      .eq('id', commentId)
      .single();

    if (fetchError || !existingComment) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
    }

    // Check permission: author or manager/admin
    const isAuthor = existingComment.author_id === user.id;
    const isManager = await isManagerOrAdmin(user.id);

    if (!isAuthor && !isManager) {
      return NextResponse.json(
        { error: 'Forbidden: You can only delete your own comments' },
        { status: 403 }
      );
    }

    // Delete comment
    const { error: deleteError } = await supabase
      .from('workshop_task_comments')
      .delete()
      .eq('id', commentId);

    if (deleteError) {
      throw deleteError;
    }

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error('Error deleting comment:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/workshop-tasks/comments/[commentId]',
      additionalData: {
        endpoint: 'DELETE /api/workshop-tasks/comments/[commentId]',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
