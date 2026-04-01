import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logServerError } from '@/lib/utils/server-error-logger';

interface RouteParams {
  params: Promise<{ taskId: string }>;
}

type DynamicDbClient = Awaited<ReturnType<typeof createClient>>;

async function buildTemplateSnapshot(db: DynamicDbClient, templateId: string) {
  const { data: versions, error: versionsError } = await db
    .from('workshop_attachment_template_versions')
    .select('*')
    .eq('template_id', templateId)
    .order('version_number', { ascending: false });

  if (versionsError) {
    throw versionsError;
  }

  if (!versions || versions.length === 0) {
    return null;
  }

  const publishedVersion = versions.find((version: { status: string }) => version.status === 'published');
  const activeVersion = publishedVersion || versions[0];

  const { data: sections, error: sectionsError } = await db
    .from('workshop_attachment_template_sections')
    .select('*')
    .eq('version_id', activeVersion.id)
    .order('sort_order', { ascending: true });

  if (sectionsError) {
    throw sectionsError;
  }

  const sectionIds = (sections || []).map((section: { id: string }) => section.id);
  let fields: Array<Record<string, unknown>> = [];

  if (sectionIds.length > 0) {
    const { data: fieldRows, error: fieldsError } = await db
      .from('workshop_attachment_template_fields')
      .select('*')
      .in('section_id', sectionIds)
      .order('sort_order', { ascending: true });

    if (fieldsError) {
      throw fieldsError;
    }
    fields = fieldRows || [];
  }

  const typedSections = (sections || []) as Array<Record<string, unknown> & { id: string }>;
  const typedFields = fields as Array<Record<string, unknown> & { section_id?: string }>;

  return {
    template_version_id: activeVersion.id as string,
    snapshot_json: {
      template_id: templateId,
      version_id: activeVersion.id as string,
      generated_at: new Date().toISOString(),
      sections: typedSections.map((section) => ({
        id: section.id,
        section_key: section.section_key,
        title: section.title,
        description: section.description || null,
        sort_order: section.sort_order,
        fields: typedFields
          .filter((field) => field.section_id === section.id)
          .map((field) => ({
            id: field.id,
            field_key: field.field_key,
            label: field.label,
            help_text: field.help_text || null,
            field_type: field.field_type,
            is_required: field.is_required,
            sort_order: field.sort_order,
            options_json: field.options_json || null,
            validation_json: field.validation_json || null,
          })),
      })),
    },
  };
}

/**
 * GET /api/workshop-tasks/attachments/task/[taskId]
 * Get all attachments for a task with V2 schema context.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { taskId } = await params;
    const supabase = await createClient();
    const db = supabase;
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get attachments with templates
    const { data: attachments, error: attachmentsError } = await db
      .from('workshop_task_attachments')
      .select(`
        *,
        workshop_attachment_templates (
          id,
          name,
          description,
          is_active
        )
      `)
      .eq('task_id', taskId)
      .order('created_at', { ascending: true });

    if (attachmentsError) {
      throw attachmentsError;
    }

    const attachmentIds = (attachments || []).map((a: { id: string }) => a.id);
    let schemaSnapshots: unknown[] = [];
    let fieldResponsesV2: unknown[] = [];

    if (attachmentIds.length > 0) {
      const { data: snapshotsData, error: snapshotsError } = await db
        .from('workshop_attachment_schema_snapshots')
        .select('*')
        .in('attachment_id', attachmentIds);

      if (snapshotsError) {
        throw snapshotsError;
      }
      schemaSnapshots = snapshotsData || [];

      const { data: fieldResponsesData, error: fieldResponsesError } = await db
        .from('workshop_attachment_field_responses')
        .select('*')
        .in('attachment_id', attachmentIds);

      if (fieldResponsesError) {
        throw fieldResponsesError;
      }
      fieldResponsesV2 = fieldResponsesData || [];
    }

    // Combine data
    const typedAttachments = (attachments || []) as Array<{ id: string; template_id: string } & Record<string, unknown>>;
    const typedSnapshots = schemaSnapshots as Array<{ attachment_id?: string }>;
    const typedFieldResponses = fieldResponsesV2 as Array<{ attachment_id?: string }>;
    const result = typedAttachments.map(attachment => ({
      ...attachment,
      schema_snapshot: typedSnapshots.find((snapshot) => snapshot.attachment_id === attachment.id) || null,
      field_responses: typedFieldResponses.filter((response) => response.attachment_id === attachment.id),
    }));

    return NextResponse.json({
      success: true,
      attachments: result,
    });
  } catch (error) {
    const { taskId } = await params;
    console.error('Error fetching task attachments:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/workshop-tasks/attachments/task/[taskId]',
      additionalData: {
        endpoint: `GET /api/workshop-tasks/attachments/task/${taskId}`,
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/workshop-tasks/attachments/task/[taskId]
 * Add an attachment to a task (V2 schema required).
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { taskId } = await params;
    const supabase = await createClient();
    const db = supabase;
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { template_id } = body;

    // Validate required fields
    if (!template_id) {
      return NextResponse.json(
        { error: 'Missing required field: template_id' },
        { status: 400 }
      );
    }

    // Verify task exists and is a workshop task
    const { data: task, error: taskError } = await db
      .from('actions')
      .select('id, action_type')
      .eq('id', taskId)
      .single();

    if (taskError || !task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (!['inspection_defect', 'workshop_vehicle_task'].includes((task as { action_type: string }).action_type)) {
      return NextResponse.json(
        { error: 'Attachments can only be added to workshop tasks' },
        { status: 400 }
      );
    }

    // Verify template exists
    const { data: template, error: templateError } = await db
      .from('workshop_attachment_templates')
      .select('id')
      .eq('id', template_id)
      .single();

    if (templateError || !template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    // Check if attachment already exists for this task+template
    const { data: existingAttachment, error: duplicateCheckError } = await db
      .from('workshop_task_attachments')
      .select('id')
      .eq('task_id', taskId)
      .eq('template_id', template_id)
      .single();

    // Handle errors - PGRST116 means no rows found (expected), other errors should be thrown
    if (duplicateCheckError && duplicateCheckError.code !== 'PGRST116') {
      throw duplicateCheckError;
    }

    if (existingAttachment) {
      return NextResponse.json(
        { error: 'This template is already attached to this task' },
        { status: 409 }
      );
    }

    const snapshot = await buildTemplateSnapshot(db, template_id);
    if (!snapshot || snapshot.snapshot_json.sections.length === 0) {
      return NextResponse.json(
        { error: 'Template has no published V2 schema sections' },
        { status: 400 },
      );
    }

    // Create attachment only after schema availability is confirmed.
    const { data: attachment, error: insertError } = await db
      .from('workshop_task_attachments')
      .insert({
        task_id: taskId,
        template_id,
        status: 'pending',
        created_by: user.id,
      } as never)
      .select(`
        *,
        workshop_attachment_templates (
          id,
          name,
          description,
          is_active
        )
      `)
      .single();

    if (insertError || !attachment) {
      throw insertError || new Error('Failed to create attachment');
    }

    const { error: snapshotInsertError } = await db
      .from('workshop_attachment_schema_snapshots')
      .insert({
        attachment_id: (attachment as { id: string }).id,
        template_version_id: snapshot.template_version_id,
        snapshot_json: snapshot.snapshot_json,
        created_by: user.id,
      } as never);

    if (snapshotInsertError) {
      await db
        .from('workshop_task_attachments')
        .delete()
        .eq('id', (attachment as { id: string }).id);
      throw snapshotInsertError;
    }

    return NextResponse.json({
      success: true,
      attachment: {
        ...attachment,
        schema_snapshot: snapshot
          ? {
              template_version_id: snapshot.template_version_id,
              snapshot_json: snapshot.snapshot_json,
            }
          : null,
        field_responses: [],
      },
    }, { status: 201 });
  } catch (error) {
    const { taskId } = await params;
    console.error('Error creating task attachment:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/workshop-tasks/attachments/task/[taskId]',
      additionalData: {
        endpoint: `POST /api/workshop-tasks/attachments/task/${taskId}`,
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
