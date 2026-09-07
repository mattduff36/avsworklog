import { NextRequest } from 'next/server';
import { z } from 'zod';
import { logServerError } from '@/lib/utils/server-error-logger';
import { requireWorkshopTasksManagerAccess } from '@/lib/server/workshop-tasks/auth';
import { jsonWithWorkshopSession } from '@/lib/server/workshop-tasks/http';
import {
  WorkshopCorrectionError,
  correctCompletedWorkshopTask,
} from '@/lib/server/workshop-completed-task-correction';
import { CorrectCompletedTaskBodySchema } from '@/lib/workshop-tasks/completed-correction';

const ParamsSchema = z.object({
  taskId: z.string().uuid(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const access = await requireWorkshopTasksManagerAccess();
  try {
    if (!access.ok) {
      return jsonWithWorkshopSession(
        access.validation,
        { error: access.status === 401 ? 'Unauthorized' : 'Only managers or admins can correct completed tasks' },
        access.status
      );
    }

    const parsedParams = ParamsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return jsonWithWorkshopSession(access.validation, { error: 'A valid task id is required' }, 400);
    }

    const rawBody = await request.json();
    const parsedBody = CorrectCompletedTaskBodySchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return jsonWithWorkshopSession(
        access.validation,
        { error: parsedBody.error.issues[0]?.message || 'Invalid correction payload' },
        400
      );
    }

    const result = await correctCompletedWorkshopTask({
      taskId: parsedParams.data.taskId,
      actorId: access.userId,
      body: parsedBody.data,
    });

    return jsonWithWorkshopSession(access.validation, { success: true, result });
  } catch (error) {
    await logServerError({
      error: error instanceof Error ? error : new Error(String(error)),
      request,
      componentName: '/api/workshop-tasks/tasks/[taskId]/correct-completed',
      additionalData: {
        endpoint: 'PATCH /api/workshop-tasks/tasks/[taskId]/correct-completed',
      },
    });
    if (error instanceof WorkshopCorrectionError) {
      return jsonWithWorkshopSession(access.validation, { error: error.message }, error.status);
    }
    return jsonWithWorkshopSession(access.validation, { error: 'Failed to correct completed task' }, 500);
  }
}
