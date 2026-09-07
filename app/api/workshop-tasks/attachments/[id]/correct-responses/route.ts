import { NextRequest } from 'next/server';
import { z } from 'zod';
import { logServerError } from '@/lib/utils/server-error-logger';
import { requireWorkshopTasksManagerAccess } from '@/lib/server/workshop-tasks/auth';
import { jsonWithWorkshopSession } from '@/lib/server/workshop-tasks/http';
import { correctCompletedAttachmentResponses } from '@/lib/server/workshop-attachment-correction';
import { WorkshopCorrectionError } from '@/lib/server/workshop-completed-task-correction';
import { CorrectAttachmentResponsesBodySchema } from '@/lib/workshop-tasks/completed-correction';

const ParamsSchema = z.object({
  id: z.string().uuid(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const access = await requireWorkshopTasksManagerAccess();
  try {
    if (!access.ok) {
      return jsonWithWorkshopSession(
        access.validation,
        { error: access.status === 401 ? 'Unauthorized' : 'Only managers or admins can correct completed attachments' },
        access.status
      );
    }

    const parsedParams = ParamsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return jsonWithWorkshopSession(access.validation, { error: 'A valid attachment id is required' }, 400);
    }

    const rawBody = await request.json();
    const parsedBody = CorrectAttachmentResponsesBodySchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return jsonWithWorkshopSession(
        access.validation,
        { error: parsedBody.error.issues[0]?.message || 'Invalid attachment correction payload' },
        400
      );
    }

    const result = await correctCompletedAttachmentResponses({
      attachmentId: parsedParams.data.id,
      actorId: access.userId,
      body: parsedBody.data,
    });

    return jsonWithWorkshopSession(access.validation, { success: true, result });
  } catch (error) {
    await logServerError({
      error: error instanceof Error ? error : new Error(String(error)),
      request,
      componentName: '/api/workshop-tasks/attachments/[id]/correct-responses',
      additionalData: {
        endpoint: 'POST /api/workshop-tasks/attachments/[id]/correct-responses',
      },
    });
    if (error instanceof WorkshopCorrectionError) {
      return jsonWithWorkshopSession(access.validation, { error: error.message }, error.status);
    }
    return jsonWithWorkshopSession(access.validation, { error: 'Failed to correct attachment responses' }, 500);
  }
}
