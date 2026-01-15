import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { userHasPermission } from '@/lib/utils/permissions';
import { logServerError } from '@/lib/utils/server-error-logger';
import { UUIDSchema, ListCommentsQuerySchema } from '@/lib/validation/schemas';

// Timeline item types
type StatusEvent = {
  id: string;
  type: 'status_event';
  created_at: string;
  author: { id: string; full_name: string } | null;
  body: string;
  meta: {
    status: string;
  };
};

type Comment = {
  id: string;
  type: 'comment';
  created_at: string;
  author: { id: string; full_name: string } | null;
  body: string;
  can_edit: boolean;
  can_delete: boolean;
};

type TimelineItem = StatusEvent | Comment;

/**
 * GET /api/workshop-tasks/tasks/:taskId/comments
 * Returns unified timeline: status events + comments
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Validate taskId
    const { taskId } = await params;
    const taskIdValidation = UUIDSchema.safeParse(taskId);
    if (!taskIdValidation.success) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
    }

    // Check workshop-tasks permission
    const hasPermission = await userHasPermission(user.id, 'workshop-tasks');
    if (!hasPermission) {
      return NextResponse.json(
        { error: 'Forbidden: workshop-tasks permission required' },
        { status: 403 }
      );
    }

    // Parse query params
    const searchParams = request.nextUrl.searchParams;
    const queryValidation = ListCommentsQuerySchema.safeParse({
      cursor: searchParams.get('cursor') || undefined,
      limit: parseInt(searchParams.get('limit') || '20'),
      order: searchParams.get('order') || 'asc',
    });

    if (!queryValidation.success) {
      return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 });
    }

    const { limit, order } = queryValidation.data;

    // Fetch the task (verify it exists and is a workshop task)
    const { data: task, error: taskError } = await supabase
      .from('actions')
      .select('id, action_type, created_at, created_by, logged_at, logged_by, logged_comment, actioned_at, actioned_by, actioned_comment')
      .eq('id', taskId)
      .single();

    if (taskError || !task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (!['inspection_defect', 'workshop_vehicle_task'].includes(task.action_type)) {
      return NextResponse.json(
        { error: 'Task is not a workshop task' },
        { status: 400 }
      );
    }

    // Fetch comments
    const { data: comments, error: commentsError } = await supabase
      .from('workshop_task_comments')
      .select(`
        id,
        body,
        created_at,
        author_id,
        profiles:author_id (
          id,
          full_name
        )
      `)
      .eq('task_id', taskId)
      .order('created_at', { ascending: order === 'asc' })
      .limit(limit);

    if (commentsError) {
      throw commentsError;
    }

    // Build timeline items array
    const timelineItems: TimelineItem[] = [];

    // Add "Marked In Progress" status event if logged
    if (task.logged_at && task.logged_by) {
      const { data: loggedByProfile } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('id', task.logged_by)
        .single();

      timelineItems.push({
        id: `status:logged:${task.id}`,
        type: 'status_event',
        created_at: task.logged_at,
        author: loggedByProfile || null,
        body: task.logged_comment || 'Marked as In Progress',
        meta: { status: 'logged' },
      });
    }

    // Add "Marked Complete" status event if completed
    if (task.actioned_at && task.actioned_by) {
      const { data: actionedByProfile } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('id', task.actioned_by)
        .single();

      timelineItems.push({
        id: `status:completed:${task.id}`,
        type: 'status_event',
        created_at: task.actioned_at,
        author: actionedByProfile || null,
        body: task.actioned_comment || 'Marked as Complete',
        meta: { status: 'completed' },
      });
    }

    // Add freeform comments
    if (comments) {
      for (const comment of comments) {
        timelineItems.push({
          id: comment.id,
          type: 'comment',
          created_at: comment.created_at,
          author: comment.profiles ? {
            id: (comment.profiles as any).id,
            full_name: (comment.profiles as any).full_name,
          } : null,
          body: comment.body,
          can_edit: comment.author_id === user.id, // TODO: Add manager check
          can_delete: comment.author_id === user.id, // TODO: Add manager check
        });
      }
    }

    // Sort timeline by created_at
    timelineItems.sort((a, b) => {
      const dateA = new Date(a.created_at).getTime();
      const dateB = new Date(b.created_at).getTime();
      return order === 'asc' ? dateA - dateB : dateB - dateA;
    });

    return NextResponse.json({
      success: true,
      taskId,
      items: timelineItems,
      // nextCursor: undefined, // TODO: Implement pagination if needed
    });
  } catch (error) {
    console.error('Error fetching comments:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/workshop-tasks/tasks/[taskId]/comments',
      additionalData: {
        endpoint: 'GET /api/workshop-tasks/tasks/[taskId]/comments',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/workshop-tasks/tasks/:taskId/comments
 * Create a new comment
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Validate taskId
    const { taskId } = await params;
    const taskIdValidation = UUIDSchema.safeParse(taskId);
    if (!taskIdValidation.success) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
    }

    // Check workshop-tasks permission
    const hasPermission = await userHasPermission(user.id, 'workshop-tasks');
    if (!hasPermission) {
      return NextResponse.json(
        { error: 'Forbidden: workshop-tasks permission required' },
        { status: 403 }
      );
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
        { error: 'Task is not a workshop task' },
        { status: 400 }
      );
    }

    // Insert comment
    const { data: comment, error: insertError } = await supabase
      .from('workshop_task_comments')
      .insert({
        task_id: taskId,
        author_id: user.id,
        body: bodyText,
      })
      .select(`
        id,
        task_id,
        body,
        created_at,
        author_id,
        profiles:author_id (
          id,
          full_name
        )
      `)
      .single();

    if (insertError) {
      throw insertError;
    }

    return NextResponse.json({
      success: true,
      comment: {
        id: comment.id,
        type: 'comment',
        created_at: comment.created_at,
        author: comment.profiles ? {
          id: (comment.profiles as any).id,
          full_name: (comment.profiles as any).full_name,
        } : null,
        body: comment.body,
        can_edit: true,
        can_delete: true,
      },
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating comment:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/workshop-tasks/tasks/[taskId]/comments',
      additionalData: {
        endpoint: 'POST /api/workshop-tasks/tasks/[taskId]/comments',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
