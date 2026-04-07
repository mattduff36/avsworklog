import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logServerError } from '@/lib/utils/server-error-logger';
import { validateRequiredSchemaResponses } from '@/lib/workshop-attachments/schema-validation';
import type { AttachmentSchemaSection } from '@/types/workshop-attachments-v2';

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface SnapshotJson {
  template_id: string;
  version_id: string | null;
  generated_at: string;
  sections: AttachmentSchemaSection[];
}

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

interface FieldResponseInput {
  field_id?: string | null;
  section_key: string;
  field_key: string;
  response_value?: string | null;
  response_json?: Record<string, unknown> | null;
}

interface AttachmentStatusRow {
  id: string;
  status: string | null;
}

function normalizeValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/**
 * GET /api/workshop-tasks/attachments/[id]/schema
 * Returns immutable schema snapshot and v2 field responses.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: attachmentId } = await params;
    const supabase = await createClient();
    type DbClient = { from: (t: string) => ReturnType<typeof supabase.from> };
    const db = supabase as unknown as DbClient;
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: attachment, error: attachmentError } = await db
      .from('workshop_task_attachments')
      .select('id, template_id, status, completed_at, completed_by')
      .eq('id', attachmentId)
      .single();

    if (attachmentError || !attachment) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }

    const { data: snapshotRows, error: snapshotError } = await db
      .from('workshop_attachment_schema_snapshots')
      .select('*')
      .eq('attachment_id', attachmentId)
      .limit(1);

    if (snapshotError) {
      throw snapshotError;
    }

    const snapshot = snapshotRows && snapshotRows.length > 0 ? snapshotRows[0] : null;

    const { data: responses, error: responsesError } = await db
      .from('workshop_attachment_field_responses')
      .select('*')
      .eq('attachment_id', attachmentId);

    if (responsesError) {
      throw responsesError;
    }

    return NextResponse.json({
      success: true,
      attachment,
      snapshot,
      responses: responses || [],
    }, {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    const { id: attachmentId } = await params;
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/workshop-tasks/attachments/[id]/schema',
      additionalData: {
        endpoint: `GET /api/workshop-tasks/attachments/${attachmentId}/schema`,
      },
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/workshop-tasks/attachments/[id]/schema
 * Saves field responses for schema v2 attachments.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: attachmentId } = await params;
    const supabase = await createClient();
    type DbClient = { from: (t: string) => ReturnType<typeof supabase.from> };
    const db = supabase as unknown as DbClient;
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const markComplete = body.mark_complete === true;
    const responsesInput = Array.isArray(body.responses) ? (body.responses as FieldResponseInput[]) : null;

    if (!responsesInput) {
      return NextResponse.json({ error: 'Invalid request body: responses must be an array' }, { status: 400 });
    }

    const { data: attachment, error: attachmentError } = await db
      .from('workshop_task_attachments')
      .select('id, status')
      .eq('id', attachmentId)
      .single();

    if (attachmentError || !attachment) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }

    const typedAttachment = attachment as AttachmentStatusRow;
    if (typedAttachment.status === 'completed') {
      return NextResponse.json(
        { error: 'Attachment is completed and cannot be modified.' },
        { status: 409 },
      );
    }

    const { data: snapshotRows, error: snapshotError } = await db
      .from('workshop_attachment_schema_snapshots')
      .select('*')
      .eq('attachment_id', attachmentId)
      .limit(1);

    if (snapshotError) {
      throw snapshotError;
    }

    if (!snapshotRows || snapshotRows.length === 0) {
      return NextResponse.json(
        { error: 'No schema snapshot exists for this attachment.' },
        { status: 400 }
      );
    }

    const snapshot = snapshotRows[0] as { snapshot_json: SnapshotJson };
    const snapshotJson = snapshot.snapshot_json;
    const snapshotSections = Array.isArray(snapshotJson.sections) ? snapshotJson.sections : [];

    const rowsToUpsert = responsesInput
      .filter((entry) => normalizeValue(entry.section_key).length > 0 && normalizeValue(entry.field_key).length > 0)
      .map((entry) => ({
        attachment_id: attachmentId,
        field_id: entry.field_id ?? null,
        section_key: entry.section_key,
        field_key: entry.field_key,
        response_value: entry.response_value?.toString() ?? null,
        response_json: entry.response_json ?? null,
      }));

    if (rowsToUpsert.length > 0) {
      const { error: upsertError } = await db
        .from('workshop_attachment_field_responses')
        .upsert(rowsToUpsert as never, {
          onConflict: 'attachment_id,section_key,field_key',
        });

      if (upsertError) {
        throw upsertError;
      }
    }

    const { data: updatedResponses, error: fetchResponsesError } = await db
      .from('workshop_attachment_field_responses')
      .select('*')
      .eq('attachment_id', attachmentId);

    if (fetchResponsesError) {
      throw fetchResponsesError;
    }

    if (markComplete) {
      const typedResponses = (updatedResponses || []) as Array<{
        section_key: string;
        field_key: string;
        response_value: string | null;
        response_json: Record<string, unknown> | null;
      }>;
      const errors = validateRequiredSchemaResponses(snapshotSections, typedResponses);

      if (errors.length > 0) {
        return NextResponse.json(
          { error: 'Cannot mark attachment as complete: missing required schema responses', details: errors },
          { status: 400 }
        );
      }

      const { error: completeError } = await db
        .from('workshop_task_attachments')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          completed_by: user.id,
        } as never)
        .eq('id', attachmentId);

      if (completeError) {
        throw completeError;
      }
    }

    const { data: refreshedAttachment, error: refreshedAttachmentError } = await db
      .from('workshop_task_attachments')
      .select('*')
      .eq('id', attachmentId)
      .single();

    if (refreshedAttachmentError) {
      throw refreshedAttachmentError;
    }

    return NextResponse.json({
      success: true,
      attachment: refreshedAttachment,
      responses: updatedResponses || [],
    });
  } catch (error) {
    const { id: attachmentId } = await params;
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/workshop-tasks/attachments/[id]/schema',
      additionalData: {
        endpoint: `POST /api/workshop-tasks/attachments/${attachmentId}/schema`,
      },
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
