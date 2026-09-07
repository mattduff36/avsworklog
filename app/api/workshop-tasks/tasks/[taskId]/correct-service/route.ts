import { NextRequest } from 'next/server';
import { logServerError } from '@/lib/utils/server-error-logger';
import { requireWorkshopTasksManagerAccess } from '@/lib/server/workshop-tasks/auth';
import { jsonWithWorkshopSession } from '@/lib/server/workshop-tasks/http';
import {
  AssetServiceError,
  correctServiceWorkshopTask,
  getServiceCorrectionContext,
} from '@/lib/server/asset-service';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const access = await requireWorkshopTasksManagerAccess();
  try {
    if (!access.ok) {
      return jsonWithWorkshopSession(
        access.validation,
        { error: access.status === 401 ? 'Unauthorized' : 'Only managers or admins can correct completed Service tasks' },
        access.status
      );
    }

    const { taskId } = await params;
    const context = await getServiceCorrectionContext(taskId);
    return jsonWithWorkshopSession(access.validation, { context });
  } catch (error) {
    if (error instanceof AssetServiceError) {
      return jsonWithWorkshopSession(access.validation, { error: error.message }, error.status);
    }
    return jsonWithWorkshopSession(
      access.validation,
      { error: 'Failed to load service correction context' },
      500
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const access = await requireWorkshopTasksManagerAccess();
  try {
    if (!access.ok) {
      return jsonWithWorkshopSession(
        access.validation,
        { error: access.status === 401 ? 'Unauthorized' : 'Only managers or admins can correct completed Service tasks' },
        access.status
      );
    }

    const { taskId } = await params;
    const body = await request.json();

    const result = await correctServiceWorkshopTask({
      taskId,
      actorId: access.userId,
      completionMeter: Number(body.completionMeter),
      confirmedNextTemplateId: String(body.confirmedNextTemplateId || ''),
      correctionComment: String(body.correctionComment || ''),
    });

    return jsonWithWorkshopSession(access.validation, { success: true, result });
  } catch (error) {
    await logServerError({
      error: error instanceof Error ? error : new Error(String(error)),
      request,
      componentName: '/api/workshop-tasks/tasks/[taskId]/correct-service',
      additionalData: {
        endpoint: 'POST /api/workshop-tasks/tasks/[taskId]/correct-service',
      },
    });
    if (error instanceof AssetServiceError) {
      return jsonWithWorkshopSession(access.validation, { error: error.message }, error.status);
    }
    return jsonWithWorkshopSession(access.validation, { error: 'Failed to correct service task' }, 500);
  }
}
