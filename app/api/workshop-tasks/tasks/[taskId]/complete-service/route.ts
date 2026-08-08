import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { userHasPermission } from '@/lib/utils/permissions';
import { logServerError } from '@/lib/utils/server-error-logger';
import {
  AssetServiceError,
  completeServiceWorkshopTask,
} from '@/lib/server/asset-service';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const hasPermission = await userHasPermission(user.id, 'workshop-tasks');
    if (!hasPermission) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { taskId } = await params;
    const body = await request.json();

    const result = await completeServiceWorkshopTask({
      taskId,
      actorId: user.id,
      completionMeter: Number(body.completionMeter),
      confirmedNextTemplateId: String(body.confirmedNextTemplateId || ''),
      completedComment: String(body.completedComment || ''),
      completedAt: String(body.completedAt || new Date().toISOString()),
      completedSignatureData: body.completedSignatureData ?? null,
      intermediateComment: body.intermediateComment ?? null,
      intermediateAt: body.intermediateAt ?? null,
      createdAt: body.createdAt ?? null,
      statusHistoryJson: body.statusHistory ?? [],
    });

    return NextResponse.json({ success: true, result });
  } catch (error) {
    await logServerError({
      error: error instanceof Error ? error : new Error(String(error)),
      request,
      componentName: '/api/workshop-tasks/tasks/[taskId]/complete-service',
      additionalData: {
        endpoint: 'POST /api/workshop-tasks/tasks/[taskId]/complete-service',
      },
    });
    if (error instanceof AssetServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: 'Failed to complete service task' }, { status: 500 });
  }
}
