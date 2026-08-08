import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isEffectiveRoleManagerOrHigher } from '@/lib/utils/rbac';
import { logServerError } from '@/lib/utils/server-error-logger';
import {
  AssetServiceError,
  correctServiceWorkshopTask,
  getServiceCorrectionContext,
} from '@/lib/server/asset-service';

async function requireManager() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  if (!(await isEffectiveRoleManagerOrHigher())) {
    return {
      error: NextResponse.json(
        { error: 'Only managers or admins can correct completed Service tasks' },
        { status: 403 },
      ),
    };
  }
  return { user };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const auth = await requireManager();
    if ('error' in auth && auth.error) return auth.error;
    const { taskId } = await params;
    const context = await getServiceCorrectionContext(taskId);
    return NextResponse.json({ context });
  } catch (error) {
    if (error instanceof AssetServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: 'Failed to load service correction context' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const auth = await requireManager();
    if ('error' in auth && auth.error) return auth.error;
    const user = auth.user;

    const { taskId } = await params;
    const body = await request.json();

    const result = await correctServiceWorkshopTask({
      taskId,
      actorId: user.id,
      completionMeter: Number(body.completionMeter),
      confirmedNextTemplateId: String(body.confirmedNextTemplateId || ''),
      correctionComment: String(body.correctionComment || ''),
    });

    return NextResponse.json({ success: true, result });
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
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: 'Failed to correct service task' }, { status: 500 });
  }
}
